"use server";

// Billing server actions (SPEC §10 Billing). Mutations here never write paid
// subscription state directly — they mint Stripe Checkout/Portal URLs and let the
// webhooks mirror the outcome (rule 3). Every action returns `{ ok, redirectTo }` for
// the client to window.location.assign(): Checkout/Portal are cross-origin, and the
// dashboard's own return paths ride the app-host Host-rewrite that a server-action
// redirect() would skip (the repo's hard-navigation gotcha).
import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { creditBalance, creditLedger, billingSubscription } from "@/lib/db/app-schema";
import { getSession, listOrganizations, getMemberRole } from "@/lib/session";
import { canSee } from "@/lib/features";
import {
  BillingNotConfiguredError,
  createPackCheckout,
  createPlanCheckout,
  createPortalSession,
  setStripeCancelAtPeriodEnd,
  updateSubscriptionPrice,
} from "@/lib/billing/stripe";

type ActionResult = { ok: true; redirectTo: string } | { ok: false; error: string };

/** Resolve + authorize: signed-in owner/admin of the org. Billing is money — member
 *  and viewer roles can look at the page but not act (enforced here, not just hidden). */
type ManagerContext =
  | { ok: false; error: string }
  | {
      ok: true;
      session: NonNullable<Awaited<ReturnType<typeof getSession>>>;
      org: { id: string; slug: string };
    };

async function requireBillingManager(orgSlug: string): Promise<ManagerContext> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Signed out." };
  const org = (await listOrganizations())?.find((o) => o.slug === orgSlug);
  if (!org) return { ok: false, error: "Organization not found." };
  const role = await getMemberRole(org.id, session.user.id);
  if (!canSee("admin", role))
    return { ok: false, error: "Only owners and admins can manage billing." };
  return { ok: true, session, org: { id: org.id, slug: org.slug } };
}

/** The app-host origin for Stripe return URLs, derived from the live request Host so
 *  dev ports and preview deploys round-trip correctly. */
async function appOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "app.papervine.io";
  const proto = host.includes("localhost") ? "http" : "https";
  return `${proto}://${host}`;
}

export async function startPlanCheckout(
  orgSlug: string,
  planKey: string,
  interval: "month" | "year",
): Promise<ActionResult> {
  const ctx = await requireBillingManager(orgSlug);
  if (!ctx.ok) return { ok: false, error: ctx.error };
  try {
    const base = await appOrigin();
    const url = await createPlanCheckout({
      organizationId: ctx.org.id,
      planKey,
      interval,
      customerEmail: ctx.session.user.email,
      successUrl: `${base}/${orgSlug}/billing?checkout=success`,
      cancelUrl: `${base}/${orgSlug}/billing?checkout=canceled`,
    });
    return { ok: true, redirectTo: url };
  } catch (err) {
    if (err instanceof BillingNotConfiguredError)
      return { ok: false, error: "Billing isn't configured on this deployment yet." };
    console.error("[billing] plan checkout failed:", err);
    return { ok: false, error: "Could not start checkout — try again." };
  }
}

export async function startPackCheckout(
  orgSlug: string,
  packKey: string,
): Promise<ActionResult> {
  const ctx = await requireBillingManager(orgSlug);
  if (!ctx.ok) return { ok: false, error: ctx.error };
  try {
    const base = await appOrigin();
    const url = await createPackCheckout({
      organizationId: ctx.org.id,
      packKey,
      customerEmail: ctx.session.user.email,
      successUrl: `${base}/${orgSlug}/billing?pack=success`,
      cancelUrl: `${base}/${orgSlug}/billing?pack=canceled`,
    });
    return { ok: true, redirectTo: url };
  } catch (err) {
    if (err instanceof BillingNotConfiguredError)
      return { ok: false, error: "Billing isn't configured on this deployment yet." };
    console.error("[billing] pack checkout failed:", err);
    return { ok: false, error: "Could not start checkout — try again." };
  }
}

export async function openBillingPortal(orgSlug: string): Promise<ActionResult> {
  const ctx = await requireBillingManager(orgSlug);
  if (!ctx.ok) return { ok: false, error: ctx.error };
  try {
    const base = await appOrigin();
    const url = await createPortalSession({
      organizationId: ctx.org.id,
      returnUrl: `${base}/${orgSlug}/billing`,
    });
    return { ok: true, redirectTo: url };
  } catch (err) {
    if (err instanceof BillingNotConfiguredError)
      return { ok: false, error: "Billing isn't configured on this deployment yet." };
    console.error("[billing] portal failed:", err);
    return { ok: false, error: "No billing account yet — subscribe to a plan first." };
  }
}

/**
 * Switch plans. Two paths (SPEC §10 Billing): an org with a LIVE Stripe subscription
 * gets an in-place `subscriptions.update` with proration — a second Checkout would
 * create a second subscription — and the webhook mirrors the change back; an org
 * without one (free, trialing, canceled) goes through Checkout as a new purchase.
 * Returns `changed: true` for the in-place path (client refreshes) or a redirectTo
 * for the Checkout path (client hard-navigates).
 */
export async function changePlan(
  orgSlug: string,
  planKey: string,
  interval: "month" | "year",
): Promise<{ ok: true; changed: true } | ActionResult> {
  const ctx = await requireBillingManager(orgSlug);
  if (!ctx.ok) return { ok: false, error: ctx.error };
  const [sub] = await db
    .select({
      stripeSubscriptionId: billingSubscription.stripeSubscriptionId,
      status: billingSubscription.status,
    })
    .from(billingSubscription)
    .where(eq(billingSubscription.organizationId, ctx.org.id))
    .limit(1);
  const live =
    sub?.stripeSubscriptionId && sub.status !== "canceled" ? sub.stripeSubscriptionId : null;
  if (!live) return startPlanCheckout(orgSlug, planKey, interval);
  try {
    await updateSubscriptionPrice({ stripeSubscriptionId: live, planKey, interval });
    return { ok: true, changed: true };
  } catch (err) {
    if (err instanceof BillingNotConfiguredError)
      return { ok: false, error: "Billing isn't configured on this deployment yet." };
    console.error("[billing] plan change failed:", err);
    return { ok: false, error: "Could not change the plan — try again." };
  }
}

/**
 * Downgrade to Free (cancel at period end) or resume. A Stripe-backed subscription
 * cancels through Stripe (the webhook mirrors it; subscription.deleted at period end
 * does the credit bookkeeping). A subscription with NO Stripe backing — the dev seed,
 * or a support-granted plan — has nothing to cancel upstream, so it's flipped
 * directly in the DB: mark cancel-at-period-end when a period exists, else cancel
 * immediately and expire the monthly bucket (same bookkeeping the webhook path does).
 */
export async function setPlanCancelation(
  orgSlug: string,
  cancel: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireBillingManager(orgSlug);
  if (!ctx.ok) return { ok: false, error: ctx.error };
  const [sub] = await db
    .select({
      stripeSubscriptionId: billingSubscription.stripeSubscriptionId,
      status: billingSubscription.status,
      currentPeriodEnd: billingSubscription.currentPeriodEnd,
    })
    .from(billingSubscription)
    .where(eq(billingSubscription.organizationId, ctx.org.id))
    .limit(1);
  if (!sub || sub.status === "canceled")
    return { ok: false, error: "No active plan to change." };

  if (sub.stripeSubscriptionId) {
    try {
      await setStripeCancelAtPeriodEnd(sub.stripeSubscriptionId, cancel);
      // Optimistic mirror so the UI reflects it immediately; the webhook confirms.
      await db
        .update(billingSubscription)
        .set({ cancelAtPeriodEnd: cancel, updatedAt: new Date() })
        .where(eq(billingSubscription.organizationId, ctx.org.id));
      return { ok: true };
    } catch (err) {
      if (err instanceof BillingNotConfiguredError)
        return { ok: false, error: "Billing isn't configured on this deployment yet." };
      console.error("[billing] cancelation change failed:", err);
      return { ok: false, error: "Could not update the plan — try again." };
    }
  }

  // Non-Stripe subscription (seed / support-granted).
  if (!cancel) {
    await db
      .update(billingSubscription)
      .set({ cancelAtPeriodEnd: false, updatedAt: new Date() })
      .where(eq(billingSubscription.organizationId, ctx.org.id));
    return { ok: true };
  }
  if (sub.currentPeriodEnd && sub.currentPeriodEnd > new Date()) {
    await db
      .update(billingSubscription)
      .set({ cancelAtPeriodEnd: true, updatedAt: new Date() })
      .where(eq(billingSubscription.organizationId, ctx.org.id));
    // The hourly billing sweep (expireTrials) finalizes non-Stripe cancellations at
    // period end — it's the period-end biller Stripe would otherwise be.
    return { ok: true };
  }
  // No period to run out: cancel now + expire the monthly bucket (webhook-path twin).
  const [bal] = await db
    .select()
    .from(creditBalance)
    .where(eq(creditBalance.organizationId, ctx.org.id))
    .limit(1);
  const remainder = bal?.monthlyCredits ?? 0;
  if (remainder !== 0) {
    await db.insert(creditLedger).values({
      id: randomUUID(),
      organizationId: ctx.org.id,
      delta: -remainder,
      kind: "expiry",
      bucket: "monthly",
      reason: "plan canceled",
    });
    await db
      .update(creditBalance)
      .set({ monthlyCredits: 0, updatedAt: new Date() })
      .where(eq(creditBalance.organizationId, ctx.org.id));
  }
  await db
    .update(billingSubscription)
    .set({ status: "canceled", cancelAtPeriodEnd: false, updatedAt: new Date() })
    .where(eq(billingSubscription.organizationId, ctx.org.id));
  return { ok: true };
}

/** The overage opt-in (hard caps by default — SPEC §10 Billing rule 4). Org-level and
 *  deliberate: flipping it on is the only way usage can exceed the included credits. */
export async function setOverageEnabled(
  orgSlug: string,
  enabled: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireBillingManager(orgSlug);
  if (!ctx.ok) return { ok: false, error: ctx.error };
  const updated = await db
    .update(billingSubscription)
    .set({ overageEnabled: enabled, updatedAt: new Date() })
    .where(eq(billingSubscription.organizationId, ctx.org.id))
    .returning({ organizationId: billingSubscription.organizationId });
  if (updated.length === 0)
    return { ok: false, error: "No billing plan yet — overage applies to paid plans." };
  return { ok: true };
}

/**
 * Platform-admin manual credit adjustment (support's escape hatch) — the one
 * non-webhook credit mutation, and it demands an actor + reason on the ledger entry.
 * Gated by the PLATFORM_ADMIN_EMAILS allowlist, NOT org membership.
 */
export async function adminAdjustCredits(input: {
  organizationId: string;
  delta: number;
  reason: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { requirePlatformAdmin } = await import("@/lib/dashboard-context");
  const session = await requirePlatformAdmin();
  const delta = Math.trunc(input.delta);
  if (!delta) return { ok: false, error: "Delta must be a non-zero integer." };
  if (!input.reason.trim()) return { ok: false, error: "A reason is required." };
  await db.insert(creditLedger).values({
    id: randomUUID(),
    organizationId: input.organizationId,
    delta,
    kind: "adjustment",
    bucket: "pack", // adjustments land in the most durable bucket (no expiry)
    actorUserId: session.user.id,
    reason: input.reason.trim(),
  });
  await db
    .insert(creditBalance)
    .values({ organizationId: input.organizationId, packCredits: delta })
    .onConflictDoUpdate({
      target: creditBalance.organizationId,
      set: {
        packCredits: sql`${creditBalance.packCredits} + ${delta}`,
        updatedAt: new Date(),
      },
    });
  return { ok: true };
}

/** Platform-admin: publish the DB catalog to Stripe (the admin-UI twin of
 *  `npm run billing:publish`). */
export async function adminPublishToStripe(): Promise<{
  ok: boolean;
  error?: string;
  products?: number;
  prices?: number;
}> {
  const { requirePlatformAdmin } = await import("@/lib/dashboard-context");
  await requirePlatformAdmin();
  try {
    const { publishCatalogToStripe } = await import("@/lib/billing/stripe");
    const result = await publishCatalogToStripe();
    return { ok: true, ...result };
  } catch (err) {
    if (err instanceof BillingNotConfiguredError)
      return { ok: false, error: "STRIPE_SECRET_KEY is not set on this deployment." };
    console.error("[billing] admin publish failed:", err);
    return { ok: false, error: "Publish failed — see server logs." };
  }
}
