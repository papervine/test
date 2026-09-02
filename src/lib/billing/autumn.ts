import "server-only";
import type { Autumn } from "autumn-js";
import type { BillingLookup, PlanEntitlements, PlanFeatureKey } from "./core";
import { PLAN_FEATURE_KEYS } from "./catalog";

/**
 * Autumn adapter (SPEC §10 Billing). Autumn is the source of truth for plans,
 * entitlements, balances and the Stripe objects underneath them; this module is the only
 * place that talks to it, and it hands the rest of the app the shapes it already speaks —
 * `BillingLookup` above all, so `authorizeAiDecision` and its unit tests never learn that
 * the backend changed.
 *
 * Three rules this file exists to keep:
 *
 *  1. **Never throw.** Every entry point resolves to a value. `authorizeAi` fails OPEN on a
 *     failed lookup ("billing outages must not kill paid surfaces") and against Autumn that
 *     now covers a network hop out of a serverless function, not just a dead DB socket.
 *  2. **Absent configuration is not an error.** With no `AUTUMN_SECRET_KEY` — local renderer
 *     work, `npx papervine dev`, the zero-dep smoke gate — there is no billing backend at
 *     all, and the product must still render. That resolves to Free, quietly.
 *  3. **Autumn's answer is already resolved.** It expires trials and moves customers itself,
 *     so the flags and balances it returns are the current truth. We still map the
 *     subscription status through, because `resolveEntitlements`'s expiry check is a cheap
 *     backstop and collapsing to Free is the safe direction if Autumn is ever late.
 */

// Papervine's camelCase entitlement keys ↔ Autumn's snake_case feature ids. Explicit rather
// than derived: a silent mismatch here reads as "the customer doesn't have the feature",
// which is a refusal a paying customer sees and we don't.
const FEATURE_ID: Record<PlanFeatureKey, string> = {
  assistant: "assistant",
  writerAgent: "writer_agent",
  workflows: "workflows",
  sso: "sso",
  rbac: "rbac",
  previewDeployments: "preview_deployments",
  adminApis: "admin_apis",
  insights: "insights",
  scim: "scim",
  whiteLabel: "white_label",
};

/**
 * Autumn plan ids. These are the contract between this repo and the Autumn catalog — the
 * catalog is edited there now, so a rename on either side has to be made on both. Named
 * here rather than read from catalog.json, which is display copy and no longer knows what
 * is purchasable.
 */
export const TRIAL_PLAN_ID = "pro_trial";
export const FREE_PLAN_ID = "free";

/** The metered allowance features, same mapping in the other direction. */
export const AI_CREDITS_FEATURE = "ai_credits";
const SITES_FEATURE = "sites";
const EDITORS_FEATURE = "editors";
const RETENTION_FEATURE = "analytics_retention_days";

let client: Autumn | null | undefined;

/**
 * Lazy singleton. `null` (not a throw) when unconfigured — see rule 2.
 *
 * **The SDK is imported dynamically, and that is load-bearing rather than tidy.**
 * `autumn-js` is a 36MB dist, and this module is reachable from `powered-by-store`, which
 * `render-tenant.tsx` calls on every tenant docs page. A static import therefore pulls the
 * whole billing SDK into the RENDERER's module graph — which is both the thing this file's
 * own docs promise never happens ("billing is never on the render path") and, measurably, a
 * `next dev` compile slow enough to blow the smoke gate's per-request timeout on CI.
 *
 * Same reasoning as `PrismaticBurst`'s lazy `ogl` import: the heavy dependency loads when
 * something actually needs it, and a failure to load is a quiet `null`, not a broken page.
 */
async function autumn(): Promise<Autumn | null> {
  if (client !== undefined) return client;
  const secretKey = process.env.AUTUMN_SECRET_KEY;
  if (!secretKey) {
    client = null;
    return client;
  }
  try {
    const { Autumn } = await import("autumn-js");
    client = new Autumn({ secretKey });
  } catch (err) {
    console.warn("[billing] Autumn SDK failed to load — treating billing as absent:", err);
    client = null;
  }
  return client;
}

export function autumnConfigured(): boolean {
  return Boolean(process.env.AUTUMN_SECRET_KEY);
}

// --- response shapes we read -----------------------------------------------------------
// Structural, and deliberately OPEN (`[k: string]: unknown`): a real Autumn payload carries
// far more than this, and the index signature is what lets a verbatim captured response be
// used as a test fixture without trimming it down to what we happen to read today. Narrow
// these and the fixtures stop being captures and start being assumptions.

type AutumnBalance = {
  granted?: number | null;
  remaining?: number | null;
  unlimited?: boolean | null;
  overage_allowed?: boolean | null;
  [k: string]: unknown;
};
type AutumnSubscription = {
  plan_id?: string | null;
  status?: string | null;
  trial_ends_at?: number | null;
  add_on?: boolean | null;
  [k: string]: unknown;
};
export type AutumnCustomer = {
  subscriptions?: AutumnSubscription[] | null;
  balances?: Record<string, AutumnBalance | null> | null;
  // Presence IS the grant: a boolean feature the plan doesn't include is simply absent.
  flags?: Record<string, unknown> | null;
  [k: string]: unknown;
};

/** A limit Papervine expresses as -1 = unlimited; Autumn expresses as `unlimited: true`. */
function limitOf(balance: AutumnBalance | null | undefined): number {
  if (!balance) return 0;
  if (balance.unlimited) return -1;
  return balance.granted ?? 0;
}

function entitlementsOf(customer: AutumnCustomer): PlanEntitlements {
  const balances = customer.balances ?? {};
  const flags = customer.flags ?? {};
  const features = {} as Record<PlanFeatureKey, boolean>;
  for (const key of PLAN_FEATURE_KEYS) features[key] = FEATURE_ID[key] in flags;
  return {
    sites: limitOf(balances[SITES_FEATURE]),
    editors: limitOf(balances[EDITORS_FEATURE]),
    analyticsRetentionDays: limitOf(balances[RETENTION_FEATURE]),
    features,
  };
}

/**
 * The customer's paying subscription, ignoring add-ons (credit packs attach alongside a
 * plan and must not be mistaken for it). Autumn auto-enables Free, so there is normally
 * always one; `null` only for a customer Autumn has never seen.
 */
function primarySubscription(customer: AutumnCustomer) {
  return (customer.subscriptions ?? []).find((s) => !s.add_on) ?? null;
}

const STATUSES = ["trialing", "active", "past_due", "canceled"] as const;
type Status = (typeof STATUSES)[number];

function statusOf(raw: string | null | undefined): Status {
  return (STATUSES as readonly string[]).includes(raw ?? "") ? (raw as Status) : "active";
}

/**
 * PURE: an Autumn customer payload → the core's lookup shape. Extracted from the fetch so
 * it can be unit-tested against real captured responses with no network and no key — the
 * mapping is where the bugs live (a missed snake_case id silently reads as "feature not
 * granted", which is a refusal a paying customer sees).
 */
export function lookupFromCustomer(customer: AutumnCustomer): BillingLookup {
  const sub = primarySubscription(customer);
  if (!sub) return { state: "none" };
  const credits = customer.balances?.[AI_CREDITS_FEATURE];
  return {
    state: "ok",
    sub: {
      status: statusOf(sub.status),
      trialEndsAt: sub.trial_ends_at ? new Date(sub.trial_ends_at) : null,
      entitlements: entitlementsOf(customer),
    },
    // Autumn keeps ONE balance per feature; Papervine's trial/monthly/pack split was an
    // artifact of granting them separately. The pure core only sums these for the
    // pre-flight "can this org spend anything" check, so one bucket is faithful — and
    // `unlimited` has to read as spendable, not as zero.
    buckets: {
      trial: 0,
      monthly: credits?.unlimited ? Number.MAX_SAFE_INTEGER : (credits?.remaining ?? 0),
      pack: 0,
    },
    overageEnabled: Boolean(credits?.overage_allowed),
  };
}

/**
 * One read → the pure core's lookup shape. Mirrors the old Postgres version's three
 * outcomes exactly: `none` = no billing state (Free), `error` = backend trouble (fail
 * open), `ok` = resolved entitlements + spendable credits.
 */
export async function lookupOrg(organizationId: string): Promise<BillingLookup> {
  const client = await autumn();
  if (!client) return { state: "none" };
  try {
    const customer = (await client.customers.get({
      customerId: organizationId,
    })) as unknown as AutumnCustomer;
    return lookupFromCustomer(customer);
  } catch (err) {
    // A customer Autumn has never seen is "no billing state", not an outage: gate to Free
    // rather than failing open, or an unknown id would get unmetered AI for free.
    if (isNotFound(err)) return { state: "none" };
    console.warn("[billing] Autumn lookup failed — failing open:", err);
    return { state: "error" };
  }
}

function isNotFound(err: unknown): boolean {
  const status = (err as { statusCode?: number; status?: number } | null)?.statusCode
    ?? (err as { status?: number } | null)?.status;
  return status === 404;
}

/**
 * Deduct credits for one finished AI operation. Fire-and-forget from stream callbacks, so
 * it swallows everything: a metering failure must never surface to someone mid-answer. The
 * conversion from tokens happened upstream in `rateTokensToCredits` — see the SPEC note on
 * why rating stays ours rather than moving to Autumn's `ai_credit_system`.
 */
export async function trackCredits(input: {
  organizationId: string;
  credits: number;
  feature: string;
  siteId?: string | null;
  model: string;
}): Promise<void> {
  const client = await autumn();
  if (!client || input.credits <= 0) return;
  try {
    await client.track({
      customerId: input.organizationId,
      featureId: AI_CREDITS_FEATURE,
      value: input.credits,
      properties: {
        feature: input.feature,
        model: input.model,
        ...(input.siteId ? { site_id: input.siteId } : {}),
      },
    });
  } catch (err) {
    console.warn("[billing] Autumn track failed (usage not deducted):", err);
  }
}

/**
 * Put a customer on a plan. Returns a checkout URL when Stripe needs one (paid plans with
 * no card on file); free plans and trials attach outright and return null. Never throws.
 */
export async function attachPlan(input: {
  organizationId: string;
  planId: string;
  successUrl?: string;
}): Promise<{ ok: boolean; checkoutUrl?: string | null; error?: string }> {
  const client = await autumn();
  if (!client) return { ok: false, error: "Billing is not configured." };
  try {
    const res = (await client.billing.attach({
      customerId: input.organizationId,
      planId: input.planId,
      ...(input.successUrl ? { successUrl: input.successUrl } : {}),
    })) as unknown as { checkout_url?: string | null; checkoutUrl?: string | null };
    return { ok: true, checkoutUrl: res?.checkout_url ?? res?.checkoutUrl ?? null };
  } catch (err) {
    console.warn("[billing] Autumn attach failed:", err);
    return { ok: false, error: "Could not start that plan change." };
  }
}

/**
 * Ensure the org exists as an Autumn customer. Autumn auto-enables the Free plan on
 * create, so this doubles as "put a new org on Free". Non-fatal: org creation is never
 * blocked by billing.
 */
export async function ensureCustomer(input: {
  organizationId: string;
  name?: string | null;
  email?: string | null;
}): Promise<boolean> {
  const client = await autumn();
  if (!client) return false;
  try {
    await client.customers.getOrCreate({
      customerId: input.organizationId,
      ...(input.name ? { name: input.name } : {}),
      ...(input.email ? { email: input.email } : {}),
    });
    return true;
  } catch (err) {
    console.warn("[billing] Autumn customer create failed:", err);
    return false;
  }
}

// --- catalog + customer reads for the billing surfaces ---------------------------------

export type AutumnPlan = {
  id: string;
  name?: string | null;
  add_on?: boolean | null;
  auto_enable?: boolean | null;
  archived?: boolean | null;
  price?: { amount?: number | null; interval?: string | null } | null;
  items?: Array<{ feature_id?: string | null; included?: number | null }> | null;
  variant_details?: { base_plan_id?: string | null } | null;
  [k: string]: unknown;
};

/**
 * The customer record behind the billing surfaces. Separate from `lookupOrg` because those
 * pages want more than the gate does (period end, plan name, cancellation) and can afford a
 * slower call — `subscriptions.plan` is expanded so the plan's display name comes back with
 * it instead of costing a second round trip.
 *
 * Returns `null` for "no billing backend / unknown customer" and throws nothing: these are
 * dashboard reads, and a billing outage should show an empty billing page, not a 500.
 */
export async function fetchCustomer(organizationId: string): Promise<AutumnCustomer | null> {
  const client = await autumn();
  if (!client) return null;
  try {
    return (await client.customers.get({
      customerId: organizationId,
      expand: ["subscriptions.plan"],
    })) as unknown as AutumnCustomer;
  } catch (err) {
    if (!isNotFound(err)) console.warn("[billing] Autumn customer read failed:", err);
    return null;
  }
}

/** The whole Autumn catalog. Empty array when unconfigured or unreachable. */
export async function fetchPlans(): Promise<AutumnPlan[]> {
  const client = await autumn();
  if (!client) return [];
  try {
    const res = (await client.plans.list({})) as unknown as { list?: AutumnPlan[] } | AutumnPlan[];
    const list = Array.isArray(res) ? res : (res?.list ?? []);
    return list.filter((p) => !p.archived);
  } catch (err) {
    console.warn("[billing] Autumn plan list failed:", err);
    return [];
  }
}

/** Open Autumn's hosted billing portal (Stripe's, provisioned by Autumn). */
export async function billingPortalUrl(input: {
  organizationId: string;
  returnUrl?: string;
}): Promise<string | null> {
  const client = await autumn();
  if (!client) return null;
  try {
    const res = (await client.billing.openCustomerPortal({
      customerId: input.organizationId,
      ...(input.returnUrl ? { returnUrl: input.returnUrl } : {}),
    })) as unknown as { url?: string | null };
    return res?.url ?? null;
  } catch (err) {
    console.warn("[billing] Autumn portal failed:", err);
    return null;
  }
}


// --- mutations behind the billing surfaces ---------------------------------------------

/**
 * Cancel at period end, or reverse a pending cancellation. Autumn's `cancel_end_of_cycle`
 * is what `cancel_at_period_end` used to mean to us, and `uncancel` is the Resume button —
 * both are one call now, with no branch for "subscription Stripe never knew about", because
 * Autumn provisions Stripe for everything it bills.
 */
export async function setCancelation(input: {
  organizationId: string;
  cancel: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const client = await autumn();
  if (!client) return { ok: false, error: "Billing is not configured." };
  try {
    await client.billing.update({
      customerId: input.organizationId,
      cancelAction: input.cancel ? "cancel_end_of_cycle" : "uncancel",
    });
    return { ok: true };
  } catch (err) {
    console.error("[billing] Autumn cancelation change failed:", err);
    return { ok: false, error: "Could not update the plan — try again." };
  }
}

/**
 * The overage opt-in (hard caps by default — SPEC §10 Billing rule 4). A customer-level
 * billing control in Autumn, which is the same shape it had as a column: org-wide and
 * deliberate, the only way usage can exceed the included credits.
 */
export async function setOverage(input: {
  organizationId: string;
  enabled: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const client = await autumn();
  if (!client) return { ok: false, error: "Billing is not configured." };
  try {
    await client.customers.update({
      customerId: input.organizationId,
      billingControls: {
        overageAllowed: [{ featureId: AI_CREDITS_FEATURE, enabled: input.enabled }],
      },
    });
    return { ok: true };
  } catch (err) {
    console.error("[billing] Autumn overage toggle failed:", err);
    return { ok: false, error: "Could not update overage — try again." };
  }
}

/**
 * Support's escape hatch: hand an org credits directly. This replaces the actor-attributed
 * `credit_ledger` adjustment — Autumn keeps its own audit trail of balance grants, so the
 * reason rides along as metadata rather than in a column we own.
 */
export async function grantCredits(input: {
  organizationId: string;
  amount: number;
}): Promise<{ ok: boolean; error?: string }> {
  const client = await autumn();
  if (!client) return { ok: false, error: "Billing is not configured." };
  try {
    await client.balances.create({
      customerId: input.organizationId,
      featureId: AI_CREDITS_FEATURE,
      includedGrant: input.amount,
    });
    return { ok: true };
  } catch (err) {
    console.error("[billing] Autumn credit grant failed:", err);
    return { ok: false, error: "Could not adjust credits — see server logs." };
  }
}

/**
 * Platform-admin comp: put an org on a paid plan without charging for it.
 * `noBillingChanges` is what makes it a comp rather than a sale — Autumn grants the
 * entitlements and bills nothing. `months` bounds it; null is indefinite.
 */
export async function compPlan(input: {
  organizationId: string;
  planId: string;
  months: number | null;
}): Promise<{ ok: boolean; error?: string }> {
  const client = await autumn();
  if (!client) return { ok: false, error: "Billing is not configured." };
  try {
    const endsAt = input.months
      ? Date.now() + input.months * 30 * 24 * 60 * 60 * 1000
      : undefined;
    await client.billing.attach({
      customerId: input.organizationId,
      planId: input.planId,
      noBillingChanges: true,
      ...(endsAt ? { endsAt } : {}),
    });
    return { ok: true };
  } catch (err) {
    console.error("[billing] Autumn comp failed:", err);
    return { ok: false, error: "Could not grant the plan — see server logs." };
  }
}
