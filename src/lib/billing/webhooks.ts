// Stripe webhook processing (SPEC §10 Billing, rule 3): these handlers are the ONLY
// writers of paid subscription state — dashboard actions never mutate it directly, they
// send the user through Checkout/Portal and let the resulting events land here. Each
// handler is idempotent: the route layer dedupes by Stripe event id (stripe_event PK),
// and the grant path is additionally guarded by the one-monthly-grant-per-period
// partial unique index, so redeliveries and double-sends cannot double-grant.
import "server-only";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  billingCustomer,
  billingPlanVersion,
  billingPrice,
  billingSubscription,
  creditBalance,
  creditLedger,
} from "@/lib/db/app-schema";
import { periodKey } from "./core";

/** Resolve the org an event belongs to: metadata first (checkout/subscription carry
 *  papervineOrgId), customer mapping as fallback (invoice events). */
async function orgForCustomer(customerId: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(billingCustomer)
    .where(eq(billingCustomer.stripeCustomerId, customerId))
    .limit(1);
  return row?.organizationId ?? null;
}

async function latestVersionForPlan(planKey: string) {
  const [row] = await db
    .select()
    .from(billingPlanVersion)
    .where(eq(billingPlanVersion.planKey, planKey))
    .orderBy(desc(billingPlanVersion.version))
    .limit(1);
  return row ?? null;
}

/** Map a Stripe price id back to our plan via the billing_price mirror. */
async function planKeyForStripePrice(stripePriceId: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(billingPrice)
    .where(eq(billingPrice.stripePriceId, stripePriceId))
    .limit(1);
  return row?.planKey ?? null;
}

/**
 * Roll the monthly credit bucket into a new period: expire whatever remains (positive
 * remainder = unused credits; negative = overage we aren't invoicing yet — v1 forgives
 * it at rollover, the ledger records either direction truthfully), then write the new
 * period's grant. The partial unique index makes the grant INSERT a no-op on redelivery
 * — and when it no-ops, the expiry/balance reset was already done by the first delivery.
 */
async function rollMonthlyGrant(
  organizationId: string,
  credits: number,
  period: string,
  periodEnd: Date | null,
  stripeRef: string,
): Promise<void> {
  const granted = await db
    .insert(creditLedger)
    .values({
      id: randomUUID(),
      organizationId,
      delta: credits,
      kind: "grant_monthly",
      bucket: "monthly",
      periodKey: period,
      expiresAt: periodEnd,
      stripeRef,
    })
    .onConflictDoNothing()
    .returning({ id: creditLedger.id });
  if (granted.length === 0) return; // this period already granted (redelivery)

  const [bal] = await db
    .select()
    .from(creditBalance)
    .where(eq(creditBalance.organizationId, organizationId))
    .limit(1);
  const remainder = bal?.monthlyCredits ?? 0;
  if (remainder !== 0) {
    await db.insert(creditLedger).values({
      id: randomUUID(),
      organizationId,
      delta: -remainder,
      kind: "expiry",
      bucket: "monthly",
      reason: remainder > 0 ? "period rollover (unused)" : "period rollover (unbilled overage forgiven)",
      stripeRef,
    });
  }
  await db
    .insert(creditBalance)
    .values({ organizationId, monthlyCredits: credits })
    .onConflictDoUpdate({
      target: creditBalance.organizationId,
      set: { monthlyCredits: credits, updatedAt: new Date() },
    });
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const orgId = session.metadata?.papervineOrgId;
  if (!orgId) return; // not ours

  // Credit-pack purchase (mode: payment): grant immediately off session metadata.
  if (session.mode === "payment" && session.metadata?.papervinePackKey) {
    const credits = Number(session.metadata.papervinePackCredits ?? 0);
    if (!Number.isInteger(credits) || credits <= 0) return;
    // Idempotency beyond the event-id dedupe: a retry after a mid-flight crash must not
    // re-grant — one grant_pack ledger row per checkout session.
    const [already] = await db
      .select({ id: creditLedger.id })
      .from(creditLedger)
      .where(eq(creditLedger.stripeRef, session.id))
      .limit(1);
    if (already) return;
    await db.insert(creditLedger).values({
      id: randomUUID(),
      organizationId: orgId,
      delta: credits,
      kind: "grant_pack",
      bucket: "pack",
      stripeRef: session.id,
      reason: `pack ${session.metadata.papervinePackKey}`,
    });
    // Packs stack: increment, don't replace (an org can hold several).
    await db
      .insert(creditBalance)
      .values({ organizationId: orgId, packCredits: credits })
      .onConflictDoUpdate({
        target: creditBalance.organizationId,
        set: {
          packCredits: sql`${creditBalance.packCredits} + ${credits}`,
          updatedAt: new Date(),
        },
      });
    return;
  }
  // Subscription checkout: the subscription.created/updated + invoice.paid events do
  // the real state sync — nothing else needed here.
}

async function handleSubscriptionEvent(sub: Stripe.Subscription): Promise<void> {
  const orgId =
    sub.metadata?.papervineOrgId ??
    (typeof sub.customer === "string" ? await orgForCustomer(sub.customer) : null);
  if (!orgId) return;

  const stripePriceId = sub.items.data[0]?.price?.id;
  const planKey = stripePriceId ? await planKeyForStripePrice(stripePriceId) : null;
  const version = planKey ? await latestVersionForPlan(planKey) : null;

  const status =
    sub.status === "active" || sub.status === "trialing"
      ? "active"
      : sub.status === "past_due" || sub.status === "unpaid"
        ? "past_due"
        : "canceled";

  const item = sub.items.data[0];
  const values = {
    status,
    stripeSubscriptionId: sub.id,
    currentPeriodStart: item?.current_period_start
      ? new Date(item.current_period_start * 1000)
      : null,
    currentPeriodEnd: item?.current_period_end
      ? new Date(item.current_period_end * 1000)
      : null,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    trialEndsAt: null, // a paid sub supersedes any product trial
    updatedAt: new Date(),
    ...(version ? { planVersionId: version.id } : {}),
  };
  // Upsert: the org normally has a row (trial), but a support-created Stripe sub for a
  // legacy org must still land.
  if (version) {
    await db
      .insert(billingSubscription)
      .values({ organizationId: orgId, planVersionId: version.id, ...values })
      .onConflictDoUpdate({ target: billingSubscription.organizationId, set: values });
  } else {
    await db
      .update(billingSubscription)
      .set(values)
      .where(eq(billingSubscription.organizationId, orgId));
  }
}

async function handleSubscriptionDeleted(sub: Stripe.Subscription): Promise<void> {
  const orgId =
    sub.metadata?.papervineOrgId ??
    (typeof sub.customer === "string" ? await orgForCustomer(sub.customer) : null);
  if (!orgId) return;
  await db
    .update(billingSubscription)
    .set({ status: "canceled", cancelAtPeriodEnd: false, updatedAt: new Date() })
    .where(eq(billingSubscription.organizationId, orgId));
  // Expire whatever monthly credits remain — the plan that granted them is gone.
  const [bal] = await db
    .select()
    .from(creditBalance)
    .where(eq(creditBalance.organizationId, orgId))
    .limit(1);
  const remainder = bal?.monthlyCredits ?? 0;
  if (remainder !== 0) {
    await db.insert(creditLedger).values({
      id: randomUUID(),
      organizationId: orgId,
      delta: -remainder,
      kind: "expiry",
      bucket: "monthly",
      reason: "subscription canceled",
      stripeRef: sub.id,
    });
    await db
      .update(creditBalance)
      .set({ monthlyCredits: 0, updatedAt: new Date() })
      .where(eq(creditBalance.organizationId, orgId));
  }
}

async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  // Monthly credit grants ride invoice payment — the moment money actually moved.
  // Covers both the first subscription invoice and every renewal cycle.
  const customerId = typeof invoice.customer === "string" ? invoice.customer : null;
  const orgId = customerId ? await orgForCustomer(customerId) : null;
  if (!orgId) return;

  const [subRow] = await db
    .select({
      planVersionId: billingSubscription.planVersionId,
      currentPeriodEnd: billingSubscription.currentPeriodEnd,
    })
    .from(billingSubscription)
    .where(eq(billingSubscription.organizationId, orgId))
    .limit(1);
  if (!subRow) return;
  const [version] = await db
    .select()
    .from(billingPlanVersion)
    .where(eq(billingPlanVersion.id, subRow.planVersionId))
    .limit(1);
  const credits = version?.includedMonthlyCredits ?? 0;
  if (credits <= 0) return;

  // Grant is keyed to the period the invoice opens (its own period start), not "now" —
  // a redelivered event months later must not mint a fresh period's credits.
  const start = invoice.period_start ? new Date(invoice.period_start * 1000) : new Date();
  await rollMonthlyGrant(
    orgId,
    credits,
    periodKey(start),
    subRow.currentPeriodEnd,
    invoice.id ?? "invoice",
  );
}

async function handleInvoiceFailed(invoice: Stripe.Invoice): Promise<void> {
  const customerId = typeof invoice.customer === "string" ? invoice.customer : null;
  const orgId = customerId ? await orgForCustomer(customerId) : null;
  if (!orgId) return;
  // past_due keeps entitlements (dunning ≠ cutoff, billing/core.ts); Stripe retries and
  // either invoice.paid or subscription.deleted resolves the state later.
  await db
    .update(billingSubscription)
    .set({ status: "past_due", updatedAt: new Date() })
    .where(eq(billingSubscription.organizationId, orgId));
}

/** Dispatch one verified Stripe event. Unhandled types are fine — we only mirror what
 *  we model. Throwing marks the stripe_event row failed (route layer records `error`). */
export async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      return handleCheckoutCompleted(event.data.object);
    case "customer.subscription.created":
    case "customer.subscription.updated":
      return handleSubscriptionEvent(event.data.object);
    case "customer.subscription.deleted":
      return handleSubscriptionDeleted(event.data.object);
    case "invoice.paid":
      return handleInvoicePaid(event.data.object);
    case "invoice.payment_failed":
      return handleInvoiceFailed(event.data.object);
    default:
      return;
  }
}
