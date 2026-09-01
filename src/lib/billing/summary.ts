// Read model for the billing/usage surfaces (SPEC §10 Billing). Billing is ORG-level
// (one subscription + credit pool per organization), but the surfaces now live under a
// site's Settings (`/:org/:site/settings/{billing,usage}`) to match the settings IA —
// so both pages resolve `org` via requireSite and read the org's summary here. Kept
// separate from store.ts (mutation/metering) so the pages import only a query.
//
// Autumn is the source of truth for every NUMBER here; catalog.json still owns the WORDS
// (a plan's blurb is marketing copy, and Autumn has no opinion about it). That split is
// why `planBlurb` reaches into plan-content rather than reading Autumn's `description`.
import "server-only";
import {
  AI_CREDITS_FEATURE,
  fetchCustomer,
  fetchPlans,
  type AutumnPlan,
} from "./autumn";
import { PLAN_TIER_BY_KEY, type PlanKey as ContentPlanKey } from "./plan-content";
import { trialStatus, type TrialStatus } from "./core";

export type BillingSubSummary = {
  status: "trialing" | "active" | "past_due" | "canceled";
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  overageEnabled: boolean;
  planKey: string;
  includedMonthlyCredits: number;
  planName: string;
};

export type BillingSummary = {
  sub: BillingSubSummary | null;
  buckets: { trial: number; monthly: number; pack: number };
};

type AutumnSub = {
  plan_id?: string | null;
  status?: string | null;
  trial_ends_at?: number | null;
  canceled_at?: number | null;
  current_period_end?: number | null;
  add_on?: boolean | null;
  plan?: { name?: string | null } | null;
  [k: string]: unknown;
};

function ms(value: number | null | undefined): Date | null {
  return typeof value === "number" ? new Date(value) : null;
}

/** Display copy for a plan, from catalog.json — Autumn stores no marketing text. */
function planBlurb(planKey: string): string {
  return PLAN_TIER_BY_KEY[planKey as ContentPlanKey]?.blurb ?? "";
}

/** Subscription and credit balance for an org, read from Autumn.
 *  null sub = no billing state → Free (never an error; SPEC §10 Billing rule 5). */
export async function getBillingSummary(orgId: string): Promise<BillingSummary> {
  const customer = await fetchCustomer(orgId);
  const subs = (customer?.subscriptions ?? []) as AutumnSub[];
  // Credit packs attach as add-ons alongside the plan; the plan is the one that isn't one.
  const sub = subs.find((s) => !s.add_on) ?? null;
  const credits = customer?.balances?.[AI_CREDITS_FEATURE];

  return {
    sub: sub
      ? {
          status: (sub.status as BillingSubSummary["status"]) ?? "active",
          trialEndsAt: ms(sub.trial_ends_at),
          currentPeriodEnd: ms(sub.current_period_end),
          // Autumn records the intent to stop as canceled_at while the plan runs out its
          // paid period — the same thing Stripe's cancel_at_period_end meant to us.
          cancelAtPeriodEnd: Boolean(sub.canceled_at) && sub.status !== "canceled",
          overageEnabled: Boolean(credits?.overage_allowed),
          planKey: sub.plan_id ?? "free",
          includedMonthlyCredits: credits?.granted ?? 0,
          planName: sub.plan?.name ?? sub.plan_id ?? "Free",
        }
      : null,
    // One balance, not three: see the note in autumn.ts on why the bucket split retired
    // with the ledger. Kept as a triple so the pure derivation below is unchanged.
    buckets: { trial: 0, monthly: credits?.remaining ?? 0, pack: 0 },
  };
}

export type DerivedBillingState = {
  trial: TrialStatus;
  effectivePlanName: string;
  // Live paid subscription (portal + pack purchases apply).
  onPaidPlan: boolean;
  // Any live paid state — downgrade applies.
  isLivePaid: boolean;
  totalCredits: number;
};

/** Pure derivation shared by both surfaces so the "what plan am I effectively on"
 *  logic can't drift between Billing and Usage. */
export function deriveBillingState(
  summary: BillingSummary,
  now: Date,
): DerivedBillingState {
  const { sub, buckets } = summary;
  const trial = trialStatus(sub, now);
  const live = Boolean(sub && (sub.status === "active" || sub.status === "past_due"));
  // A trial or Free subscription is "live" but not paid; only a plan with a price is.
  const paid = live && sub !== null && !FREE_LIKE.has(sub.planKey);
  const effectivePlanName =
    !sub || sub.status === "canceled" || trial.state === "expired"
      ? "Free"
      : sub.planName;
  return {
    trial,
    effectivePlanName,
    // These used to differ: `onPaidPlan` meant "Stripe-backed" and `isLivePaid` also
    // covered support-granted subs with no Stripe object. Autumn provisions Stripe for
    // everything it bills, so the distinction retired with our webhook — both now mean
    // "on a paid plan", and both are kept because two pages read them by name.
    onPaidPlan: paid,
    isLivePaid: paid,
    totalCredits:
      Math.max(0, buckets.trial) +
      Math.max(0, buckets.monthly) +
      Math.max(0, buckets.pack),
  };
}

/** Plans that carry no charge, so "is this customer paying us" is false on them. */
const FREE_LIKE = new Set(["free", "pro_trial", "trial"]);

export type PlanOffer = {
  planKey: string;
  planName: string;
  blurb: string;
  monthlyCents?: number;
  yearlyCents?: number;
  /** Autumn models annual as its own plan (`team_annual`), not an interval on `team`.
   *  The card needs its id to buy it, so it travels with the offer rather than being
   *  guessed from a naming convention at the call site. */
  annualPlanKey?: string;
  credits: number;
  sort: number;
};

function includedCredits(plan: AutumnPlan): number {
  const item = (plan.items ?? []).find((i) => i.feature_id === AI_CREDITS_FEATURE);
  return item?.included ?? 0;
}

function cents(amount: number | null | undefined): number | undefined {
  return typeof amount === "number" ? Math.round(amount * 100) : undefined;
}

/**
 * Purchasable plans — the change-plan cards on the Billing surface. In Autumn a monthly
 * plan and its annual price are two plans linked by `variant_details.base_plan_id`, so the
 * variants are folded back into their base here rather than shown as separate cards.
 *
 * Ordered by monthly price. The old `sort` column was ours to set; deriving the order from
 * what a plan costs means a new tier lands in the right place without a second edit.
 */
export async function getPlanOffers(): Promise<PlanOffer[]> {
  const plans = await fetchPlans();
  const offers = new Map<string, PlanOffer>();

  for (const plan of plans) {
    if (plan.add_on || plan.variant_details?.base_plan_id) continue;
    if (!plan.price?.amount) continue; // free / contact-us tiers aren't purchasable cards
    offers.set(plan.id, {
      planKey: plan.id,
      planName: plan.name ?? plan.id,
      blurb: planBlurb(plan.id),
      monthlyCents: plan.price.interval === "month" ? cents(plan.price.amount) : undefined,
      yearlyCents: plan.price.interval === "year" ? cents(plan.price.amount) : undefined,
      credits: includedCredits(plan),
      sort: 0,
    });
  }

  // Second pass: an annual variant contributes its price to the base plan's card.
  for (const plan of plans) {
    const base = plan.variant_details?.base_plan_id;
    if (!base) continue;
    const offer = offers.get(base);
    if (!offer || !plan.price?.amount) continue;
    if (plan.price.interval === "year") {
      offer.yearlyCents = cents(plan.price.amount);
      offer.annualPlanKey = plan.id;
    } else if (plan.price.interval === "month") {
      offer.monthlyCents = cents(plan.price.amount);
    }
  }

  const list = [...offers.values()].sort(
    (a, b) => (a.monthlyCents ?? 0) - (b.monthlyCents ?? 0),
  );
  return list.map((offer, i) => ({ ...offer, sort: i }));
}

export type CreditPackOffer = {
  key: string;
  name: string;
  credits: number;
  priceCents: number;
};

/** One-time credit top-ups — Autumn add-on plans with a one-off price, cheapest first. */
export async function getCreditPacks(): Promise<CreditPackOffer[]> {
  const plans = await fetchPlans();
  return plans
    .filter((p) => p.add_on && p.price?.interval === "one_off" && p.price?.amount)
    .map((p) => ({
      key: p.id,
      name: p.name ?? p.id,
      credits: includedCredits(p),
      priceCents: cents(p.price?.amount) ?? 0,
    }))
    .sort((a, b) => a.credits - b.credits);
}
