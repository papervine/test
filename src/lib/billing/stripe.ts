// Stripe surface (SPEC §10 Billing, rule 3: Stripe is the billing authority, the DB is
// the mirror). Everything here degrades gracefully without STRIPE_SECRET_KEY — actions
// return a clear "billing not configured" error instead of throwing at import — so the
// app (and the smoke gate) never depends on Stripe being provisioned.
//
// Catalog → Stripe publishing is one-way and append-only, mirroring billing:sync's DB
// discipline: Products are created once per plan/pack and updated in place (names are
// mutable in Stripe), Prices are created for catalog rows that lack a stripe_price_id
// and NEVER mutated (Stripe prices are immutable; a price change is a new billing_price
// row from the catalog, which gets its own Stripe Price here).
import "server-only";
import Stripe from "stripe";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  billingCustomer,
  billingPlan,
  billingPrice,
  creditPack,
} from "@/lib/db/app-schema";

let cached: Stripe | null | undefined;

/** Lazy singleton; null when STRIPE_SECRET_KEY is unset (billing not configured). */
export function stripeClient(): Stripe | null {
  if (cached !== undefined) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  cached = key ? new Stripe(key) : null;
  return cached;
}

export class BillingNotConfiguredError extends Error {
  constructor() {
    super("Stripe is not configured (STRIPE_SECRET_KEY unset).");
  }
}

function requireStripe(): Stripe {
  const s = stripeClient();
  if (!s) throw new BillingNotConfiguredError();
  return s;
}

/**
 * Publish the DB catalog to Stripe: Products for paid listed plans + credit packs,
 * Prices for any billing_price / credit_pack row without a stripe id yet. Idempotent —
 * safe to re-run after every `billing:sync`; only missing objects are created. This is
 * the backend of the admin "publish to Stripe" button and the `billing:publish` script.
 */
export async function publishCatalogToStripe(): Promise<{
  products: number;
  prices: number;
}> {
  const stripe = requireStripe();
  let products = 0;
  let prices = 0;

  // Plans: paid + listed ⇒ needs a Product (free/trial bill nothing; enterprise is a
  // sales motion, not a checkout).
  const plans = await db.select().from(billingPlan);
  const priceRows = await db.select().from(billingPrice);
  for (const plan of plans) {
    const hasPaidPrices = priceRows.some((p) => p.planKey === plan.key);
    if (!hasPaidPrices) continue;
    let productId = plan.stripeProductId;
    if (!productId) {
      const product = await stripe.products.create({
        name: `Papervine ${plan.name}`,
        description: plan.blurb || undefined,
        metadata: { papervinePlanKey: plan.key },
      });
      productId = product.id;
      await db
        .update(billingPlan)
        .set({ stripeProductId: productId, updatedAt: new Date() })
        .where(eq(billingPlan.key, plan.key));
      products += 1;
    }
    for (const row of priceRows.filter(
      (p) => p.planKey === plan.key && p.active && !p.stripePriceId,
    )) {
      const price = await stripe.prices.create({
        product: productId,
        unit_amount: row.unitAmountCents,
        currency: row.currency,
        recurring: { interval: row.interval as "month" | "year" },
        metadata: { papervinePriceId: row.id },
      });
      await db
        .update(billingPrice)
        .set({ stripePriceId: price.id })
        .where(eq(billingPrice.id, row.id));
      prices += 1;
    }
  }

  // Credit packs: one Product for the family, one one-time Price per pack.
  const packs = await db
    .select()
    .from(creditPack)
    .where(and(eq(creditPack.active, true), isNull(creditPack.stripePriceId)));
  if (packs.length > 0) {
    // Find-or-create the shared "Credits" product by metadata marker.
    const existing = await stripe.products.search({
      query: `metadata['papervineCreditPack']:'family'`,
      limit: 1,
    });
    const packProduct =
      existing.data[0] ??
      (await stripe.products.create({
        name: "Papervine AI credits",
        metadata: { papervineCreditPack: "family" },
      }));
    for (const pack of packs) {
      const price = await stripe.prices.create({
        product: packProduct.id,
        unit_amount: pack.priceCents,
        currency: "usd",
        metadata: { papervinePackKey: pack.key, credits: String(pack.credits) },
      });
      await db
        .update(creditPack)
        .set({ stripePriceId: price.id })
        .where(eq(creditPack.id, pack.id));
      prices += 1;
    }
  }
  return { products, prices };
}

/** Get or create the org's Stripe Customer (kept in billing_customer — it outlives
 *  any one subscription, preserving invoice history across plan churn). */
export async function getOrCreateCustomer(
  organizationId: string,
  opts: { email?: string | null; name?: string | null } = {},
): Promise<string> {
  const stripe = requireStripe();
  const [row] = await db
    .select()
    .from(billingCustomer)
    .where(eq(billingCustomer.organizationId, organizationId))
    .limit(1);
  if (row) return row.stripeCustomerId;
  const customer = await stripe.customers.create({
    email: opts.email ?? undefined,
    name: opts.name ?? undefined,
    metadata: { papervineOrgId: organizationId },
  });
  await db
    .insert(billingCustomer)
    .values({ organizationId, stripeCustomerId: customer.id })
    .onConflictDoNothing();
  return customer.id;
}

/** Checkout for a plan subscription. Returns the hosted checkout URL — the client must
 *  hard-navigate (window.location.assign), never a soft redirect (repo gotcha). */
export async function createPlanCheckout(opts: {
  organizationId: string;
  planKey: string;
  interval: "month" | "year";
  customerEmail?: string | null;
  successUrl: string;
  cancelUrl: string;
}): Promise<string> {
  const stripe = requireStripe();
  const [price] = await db
    .select()
    .from(billingPrice)
    .where(
      and(
        eq(billingPrice.planKey, opts.planKey),
        eq(billingPrice.interval, opts.interval),
        eq(billingPrice.active, true),
      ),
    )
    .limit(1);
  if (!price?.stripePriceId) {
    throw new Error(
      `No published Stripe price for ${opts.planKey}/${opts.interval} — run billing:publish.`,
    );
  }
  const customerId = await getOrCreateCustomer(opts.organizationId, {
    email: opts.customerEmail,
  });
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: price.stripePriceId, quantity: 1 }],
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    // The webhook resolves the org from this metadata (checkout.session.completed) —
    // carried on both the session and the subscription it creates.
    metadata: { papervineOrgId: opts.organizationId, papervinePlanKey: opts.planKey },
    subscription_data: {
      metadata: { papervineOrgId: opts.organizationId, papervinePlanKey: opts.planKey },
    },
  });
  if (!session.url) throw new Error("Stripe returned no checkout URL.");
  return session.url;
}

/** One-time checkout for a credit pack (Team+ only — enforced by the caller). */
export async function createPackCheckout(opts: {
  organizationId: string;
  packKey: string;
  customerEmail?: string | null;
  successUrl: string;
  cancelUrl: string;
}): Promise<string> {
  const stripe = requireStripe();
  const [pack] = await db
    .select()
    .from(creditPack)
    .where(and(eq(creditPack.key, opts.packKey), eq(creditPack.active, true)))
    .limit(1);
  if (!pack?.stripePriceId) {
    throw new Error(`No published Stripe price for pack ${opts.packKey}.`);
  }
  const customerId = await getOrCreateCustomer(opts.organizationId, {
    email: opts.customerEmail,
  });
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    line_items: [{ price: pack.stripePriceId, quantity: 1 }],
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    metadata: {
      papervineOrgId: opts.organizationId,
      papervinePackKey: pack.key,
      papervinePackCredits: String(pack.credits),
    },
  });
  if (!session.url) throw new Error("Stripe returned no checkout URL.");
  return session.url;
}

/**
 * Switch a LIVE Stripe subscription to a different plan/interval in place, with
 * proration — the path for an org that already pays (a second Checkout would create a
 * second subscription). The webhook's customer.subscription.updated mirror (price id →
 * billing_price → plan) is what updates our DB; this only talks to Stripe.
 */
export async function updateSubscriptionPrice(opts: {
  stripeSubscriptionId: string;
  planKey: string;
  interval: "month" | "year";
}): Promise<void> {
  const stripe = requireStripe();
  const [price] = await db
    .select()
    .from(billingPrice)
    .where(
      and(
        eq(billingPrice.planKey, opts.planKey),
        eq(billingPrice.interval, opts.interval),
        eq(billingPrice.active, true),
      ),
    )
    .limit(1);
  if (!price?.stripePriceId) {
    throw new Error(
      `No published Stripe price for ${opts.planKey}/${opts.interval} — run billing:publish.`,
    );
  }
  const sub = await stripe.subscriptions.retrieve(opts.stripeSubscriptionId);
  const item = sub.items.data[0];
  if (!item) throw new Error("Subscription has no items to update.");
  await stripe.subscriptions.update(opts.stripeSubscriptionId, {
    items: [{ id: item.id, price: price.stripePriceId }],
    proration_behavior: "create_prorations",
  });
}

/** Flip cancel-at-period-end on a live Stripe subscription (downgrade-to-Free /
 *  resume). The subscription.updated webhook mirrors the flag; subscription.deleted at
 *  period end does the actual downgrade bookkeeping. */
export async function setStripeCancelAtPeriodEnd(
  stripeSubscriptionId: string,
  cancel: boolean,
): Promise<void> {
  const stripe = requireStripe();
  await stripe.subscriptions.update(stripeSubscriptionId, {
    cancel_at_period_end: cancel,
  });
}

/** Stripe Customer Portal — card updates, invoices, cancel. Self-serve so we don't
 *  build that UI. Returns the portal URL (hard-navigate, as above). */
export async function createPortalSession(opts: {
  organizationId: string;
  returnUrl: string;
}): Promise<string> {
  const stripe = requireStripe();
  const [row] = await db
    .select()
    .from(billingCustomer)
    .where(eq(billingCustomer.organizationId, opts.organizationId))
    .limit(1);
  if (!row) throw new Error("No Stripe customer for this organization yet.");
  const session = await stripe.billingPortal.sessions.create({
    customer: row.stripeCustomerId,
    return_url: opts.returnUrl,
  });
  return session.url;
}
