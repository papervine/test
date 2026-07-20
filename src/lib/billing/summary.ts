// Read model for the billing/usage surfaces (SPEC §10 Billing). Billing is ORG-level
// (one subscription + credit pool per organization), but the surfaces now live under a
// site's Settings (`/:org/:site/settings/{billing,usage}`) to match the settings IA —
// so both pages resolve `org` via requireSite and read the org's summary here. Kept
// separate from store.ts (mutation/metering) so the pages import only a query.
import "server-only";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  billingPlan,
  billingPlanVersion,
  billingPrice,
  billingSubscription,
  creditBalance,
  creditPack,
} from "@/lib/db/app-schema";
import { CATALOG, catalogPlan } from "./catalog";
import { trialStatus, type TrialStatus } from "./core";

export type BillingSubSummary = {
  status: "trialing" | "active" | "past_due" | "canceled";
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  overageEnabled: boolean;
  stripeSubscriptionId: string | null;
  planKey: string;
  includedMonthlyCredits: number;
  planName: string;
};

export type BillingSummary = {
  sub: BillingSubSummary | null;
  buckets: { trial: number; monthly: number; pack: number };
};

/** Subscription (+ pinned plan version + display row) and credit balance for an org.
 *  null sub = org has no billing row → Free (never an error; SPEC §10 Billing rule 5). */
export async function getBillingSummary(orgId: string): Promise<BillingSummary> {
  const [sub] = await db
    .select({
      status: billingSubscription.status,
      trialEndsAt: billingSubscription.trialEndsAt,
      currentPeriodEnd: billingSubscription.currentPeriodEnd,
      cancelAtPeriodEnd: billingSubscription.cancelAtPeriodEnd,
      overageEnabled: billingSubscription.overageEnabled,
      stripeSubscriptionId: billingSubscription.stripeSubscriptionId,
      planKey: billingPlanVersion.planKey,
      includedMonthlyCredits: billingPlanVersion.includedMonthlyCredits,
      planName: billingPlan.name,
    })
    .from(billingSubscription)
    .innerJoin(
      billingPlanVersion,
      eq(billingSubscription.planVersionId, billingPlanVersion.id),
    )
    .innerJoin(billingPlan, eq(billingPlanVersion.planKey, billingPlan.key))
    .where(eq(billingSubscription.organizationId, orgId))
    .limit(1);

  const [balance] = await db
    .select()
    .from(creditBalance)
    .where(eq(creditBalance.organizationId, orgId))
    .limit(1);

  return {
    sub: (sub as BillingSubSummary) ?? null,
    buckets: {
      trial: balance?.trialCredits ?? 0,
      monthly: balance?.monthlyCredits ?? 0,
      pack: balance?.packCredits ?? 0,
    },
  };
}

export type DerivedBillingState = {
  trial: TrialStatus;
  effectivePlanName: string;
  // Live Stripe-backed paid subscription (portal + pack purchases apply).
  onPaidPlan: boolean;
  // Any live paid state incl. non-Stripe (seed/support-granted) — downgrade applies.
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
  const effectivePlanName =
    !sub || sub.status === "canceled" || trial.state === "expired"
      ? "Free"
      : trial.state === "active"
        ? // Trialing → show the tier being sampled (Pro), not the internal "Trial" plan
          // name — the trial grants that tier's features (catalog.trial.representsPlanKey).
          catalogPlan(CATALOG.trial.representsPlanKey).name
        : sub.planName;
  return {
    trial,
    effectivePlanName,
    onPaidPlan: Boolean(sub && sub.status !== "canceled" && sub.stripeSubscriptionId),
    isLivePaid: Boolean(sub && (sub.status === "active" || sub.status === "past_due")),
    totalCredits:
      Math.max(0, buckets.trial) +
      Math.max(0, buckets.monthly) +
      Math.max(0, buckets.pack),
  };
}

export type PlanOffer = {
  planKey: string;
  planName: string;
  blurb: string;
  monthlyCents?: number;
  yearlyCents?: number;
  credits: number;
  sort: number;
};

/** Purchasable plans (listed, with an active published price), latest version each —
 *  the change-plan cards on the Billing surface. */
export async function getPlanOffers(): Promise<PlanOffer[]> {
  const prices = await db
    .select({
      planKey: billingPrice.planKey,
      interval: billingPrice.interval,
      unitAmountCents: billingPrice.unitAmountCents,
      planName: billingPlan.name,
      blurb: billingPlan.blurb,
      includedMonthlyCredits: billingPlanVersion.includedMonthlyCredits,
      sort: billingPlan.sort,
    })
    .from(billingPrice)
    .innerJoin(billingPlan, eq(billingPrice.planKey, billingPlan.key))
    .innerJoin(billingPlanVersion, eq(billingPlanVersion.planKey, billingPlan.key))
    .where(eq(billingPrice.active, true))
    .orderBy(billingPlan.sort, desc(billingPlanVersion.version));

  // The version join fans out one row per version — keep the latest per plan/interval.
  const seen = new Set<string>();
  const offers: PlanOffer[] = [];
  for (const p of prices) {
    let offer = offers.find((o) => o.planKey === p.planKey);
    if (!offer) {
      offer = {
        planKey: p.planKey,
        planName: p.planName,
        blurb: p.blurb,
        credits: p.includedMonthlyCredits,
        sort: p.sort,
      };
      offers.push(offer);
    }
    const key = `${p.planKey}/${p.interval}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (p.interval === "month") offer.monthlyCents = p.unitAmountCents;
    else offer.yearlyCents = p.unitAmountCents;
  }
  offers.sort((a, b) => a.sort - b.sort);
  return offers;
}

/** Active credit packs (one-time top-ups), cheapest first. */
export async function getCreditPacks() {
  return db
    .select()
    .from(creditPack)
    .where(eq(creditPack.active, true))
    .orderBy(creditPack.credits);
}
