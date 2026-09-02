// Pure billing core — rating, bucket consumption, entitlement resolution, trial state.
// No DB, no Stripe, no Date.now(): callers pass `now`. This is the unit-tested decision
// layer (playbook/testing.md "extract the pure core"); the effectful ledger/enforcement
// wrappers live in billing-store.ts (Phase 2) and only orchestrate what this decides.
import {
  CATALOG,
  FREE_ENTITLEMENTS,
  type CreditRateTable,
  type PlanEntitlements,
  type PlanFeatureKey,
} from "./catalog";

export type { PlanEntitlements, PlanFeatureKey } from "./catalog";

// ---------- rating: tokens -> credits ----------

export type TokenUsage = { tokensIn: number; tokensOut: number; model: string };

// Longest-prefix model match so "claude-haiku-4-5-20251001" hits the "claude-haiku" rate
// and unknown/future models safely fall back to `default` (rates are chosen per family,
// not per dated snapshot — a new model id must never make rating throw). Gateway-routed
// ids carry a provider prefix ("anthropic/claude-haiku-4.5", see src/lib/ai-model.ts);
// rate by the bare model so the same family costs the same on either route — without
// this, a prefixed haiku would silently bill at the pricier `default` rate.
export function rateForModel(model: string, table: CreditRateTable) {
  const slash = model.indexOf("/");
  const bare = slash >= 0 ? model.slice(slash + 1) : model;
  let best: { prefix: string; rate: { inPer1M: number; outPer1M: number } } | null = null;
  for (const [prefix, rate] of Object.entries(table.models)) {
    // Match the FULL id first (so provider-scoped keys like "ollama/" can price a
    // whole route — self-hosted inference is rated at zero, SPEC §18), then the bare
    // model (so "anthropic/claude-haiku-4.5" still hits the "claude-haiku" family).
    const hit = model.startsWith(prefix) || bare.startsWith(prefix);
    if (hit && (!best || prefix.length > best.prefix.length)) {
      best = { prefix, rate };
    }
  }
  return best?.rate ?? table.default;
}

// ceil so fractional work always rounds against us-the-vendor's floor of 1: any nonzero
// token usage costs at least 1 credit (matches how the incumbent meters — no free calls).
export function rateTokensToCredits(usage: TokenUsage, table: CreditRateTable): number {
  const { inPer1M, outPer1M } = rateForModel(usage.model, table);
  const raw =
    (Math.max(0, usage.tokensIn) * inPer1M + Math.max(0, usage.tokensOut) * outPer1M) /
    1_000_000;
  if (raw <= 0) return 0;
  return Math.max(1, Math.ceil(raw));
}

// ---------- buckets: consumption order trial -> monthly -> pack ----------

export type CreditBuckets = { trial: number; monthly: number; pack: number };
export type BucketKey = keyof CreditBuckets;

export type DebitPlan = {
  // Ledger debits to write, in consumption order. Sum equals min(cost, available)
  // (+ shortfall against `monthly` when overage absorbs it).
  debits: { bucket: BucketKey; amount: number }[];
  // Credits not covered by any bucket. With overage enabled these are billed at the
  // plan's overage rate (the monthly bucket goes negative); otherwise the op is refused.
  shortfall: number;
  allowed: boolean;
};

// Decide how a cost draws down buckets. Trial burns first (it expires soonest), then the
// monthly grant (expires at period end), then purchased packs (most durable). Overage
// only ever extends the monthly bucket — packs/trial never go negative.
export function planDebits(
  buckets: CreditBuckets,
  cost: number,
  opts: { overageEnabled: boolean },
): DebitPlan {
  if (cost <= 0) return { debits: [], shortfall: 0, allowed: true };
  const debits: DebitPlan["debits"] = [];
  let remaining = cost;
  for (const bucket of ["trial", "monthly", "pack"] as const) {
    if (remaining === 0) break;
    const available = Math.max(0, buckets[bucket]);
    const take = Math.min(available, remaining);
    if (take > 0) {
      debits.push({ bucket, amount: take });
      remaining -= take;
    }
  }
  if (remaining > 0) {
    if (!opts.overageEnabled) {
      // Hard cap (the default): refuse rather than surprise-bill. Caller surfaces an
      // upgrade/buy-credits prompt; nothing is debited on a refusal.
      return { debits: [], shortfall: remaining, allowed: false };
    }
    // Merge into the monthly debit if one exists — the contract is at most one debit
    // per bucket (ledger writers key rows off it); `shortfall` still carries the
    // overage portion for the biller.
    const monthly = debits.find((d) => d.bucket === "monthly");
    if (monthly) monthly.amount += remaining;
    else debits.push({ bucket: "monthly", amount: remaining });
  }
  return { debits, shortfall: remaining, allowed: true };
}

// Overage retail: cents owed for `credits` at a plan's cents-per-1000 rate, rounded up.
export function overageCents(credits: number, centsPerThousand: number): number {
  if (credits <= 0) return 0;
  return Math.ceil((credits * centsPerThousand) / 1000);
}

// ---------- entitlements ----------

// Subset of the billing_subscription row this layer needs — kept structural so callers
// can pass a Drizzle row or a test literal without ceremony.
export type SubscriptionState = {
  status: "trialing" | "active" | "past_due" | "canceled";
  trialEndsAt: Date | null;
  entitlements: PlanEntitlements;
};

// Resolve what an org can do. null sub (no billing row: legacy org, DB-free render path,
// billing not yet rolled out) => Free — billing absence must never throw or gate harder
// than Free. Expired trials and canceled subs also collapse to Free: `free` is the floor
// state everything lands on, which is why it needs no subscription row of its own.
export function resolveEntitlements(
  sub: SubscriptionState | null,
  now: Date,
): PlanEntitlements {
  if (!sub) return FREE_ENTITLEMENTS;
  if (sub.status === "canceled") return FREE_ENTITLEMENTS;
  if (sub.status === "trialing") {
    const ends = sub.trialEndsAt;
    if (!ends || now >= ends) return FREE_ENTITLEMENTS;
    return sub.entitlements;
  }
  // 'active' and 'past_due' both keep entitlements: past_due is Stripe retrying a card,
  // not a decision to cut the customer off — dunning UX handles that, not feature gates.
  return sub.entitlements;
}

export function hasFeature(
  sub: SubscriptionState | null,
  feature: PlanFeatureKey,
  now: Date,
): boolean {
  return resolveEntitlements(sub, now).features[feature];
}

// Scale-limit check honoring -1 = unlimited.
export function withinLimit(limit: number, current: number): boolean {
  return limit === -1 || current < limit;
}

// ---------- trial ----------

export type TrialStatus =
  | { state: "none" }
  | { state: "active"; daysLeft: number; endsAt: Date }
  | { state: "expired"; endsAt: Date };

export function trialStatus(
  sub: { status: string; trialEndsAt: Date | null } | null,
  now: Date,
): TrialStatus {
  if (!sub || sub.status !== "trialing" || !sub.trialEndsAt) return { state: "none" };
  if (now >= sub.trialEndsAt) return { state: "expired", endsAt: sub.trialEndsAt };
  const daysLeft = Math.ceil((sub.trialEndsAt.getTime() - now.getTime()) / 86_400_000);
  return { state: "active", daysLeft, endsAt: sub.trialEndsAt };
}

export function trialEndDate(start: Date): Date {
  return new Date(start.getTime() + CATALOG.trial.days * 86_400_000);
}

// ---------- AI authorization (the pure decision behind billing/store.authorizeAi) ----------

// What the store learned about an org's billing, with DB failure kept distinct from
// "no billing row": a *missing* row means Free (gate features), but a DB *error* on a
// paying customer's request must fail OPEN — billing infrastructure hiccups must never
// take down a product surface someone paid for.
export type BillingLookup =
  | { state: "ok"; sub: SubscriptionState; buckets: CreditBuckets; overageEnabled: boolean }
  | { state: "none" } // org predates billing / catalog unsynced -> Free
  | { state: "error" }; // DB unreachable -> allow, warn, skip metering

// A BillingLookup that has been through a JSON round trip (Next's data cache serializes
// values) has its one Date — `sub.trialEndsAt` — as an ISO string. Revive it, so consumers
// keep calling `.getTime()` on a Date. Anything already a Date passes through untouched, and
// the `none`/`error` shapes carry nothing to revive.
export function reviveBillingLookup(lookup: BillingLookup): BillingLookup {
  if (lookup.state !== "ok") return lookup;
  const raw: unknown = lookup.sub.trialEndsAt;
  if (raw === null || raw instanceof Date) return lookup;
  return { ...lookup, sub: { ...lookup.sub, trialEndsAt: new Date(raw as string) } };
}

export type AiAuthorization =
  | { allowed: true; metered: boolean }
  | { allowed: false; code: "upgrade_required" | "out_of_credits" };

export function authorizeAiDecision(
  lookup: BillingLookup,
  feature: PlanFeatureKey,
  now: Date,
): AiAuthorization {
  if (lookup.state === "error") return { allowed: true, metered: false };
  if (lookup.state === "none") {
    // Free gates all AI features — same answer resolveEntitlements(null) gives.
    return FREE_ENTITLEMENTS.features[feature]
      ? { allowed: true, metered: false }
      : { allowed: false, code: "upgrade_required" };
  }
  if (!resolveEntitlements(lookup.sub, now).features[feature]) {
    return { allowed: false, code: "upgrade_required" };
  }
  // Feature is in-plan: require spendable credits (any positive bucket, or overage
  // opt-in). The precise debit split happens post-stream when real token counts exist;
  // this pre-check is what keeps a drained org from starting a stream it can't pay for.
  const { trial, monthly, pack } = lookup.buckets;
  const spendable = Math.max(0, trial) + Math.max(0, monthly) + Math.max(0, pack);
  if (spendable <= 0 && !lookup.overageEnabled) {
    return { allowed: false, code: "out_of_credits" };
  }
  return { allowed: true, metered: true };
}

// ---------- period keys ----------

// Monthly grants are tagged with the UTC period they belong to ("2026-07") so renewal
// can expire exactly one period's bucket and idempotent re-runs can't double-grant.
export function periodKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ---------- support comps (platform-admin plan grants) ----------

/**
 * The subscription period for a platform-admin plan comp (billing/store.grantPlan).
 * `months` null/≤0 → an INDEFINITE comp: no period end, never swept — it runs until an
 * admin downgrades it. A positive N → a TIME-BOXED comp: it lapses to Free after ~N
 * months, finalized by the non-Stripe branch of the expireTrials sweep, which keys on
 * cancelAtPeriodEnd=true + a past currentPeriodEnd. Months are 30-day approximations,
 * matching the seed's period math (a comp isn't a billed invoice, so exactness is moot).
 */
export function compGrantPeriod(
  now: Date,
  months: number | null,
): { periodStart: Date; periodEnd: Date | null; cancelAtPeriodEnd: boolean } {
  if (!months || months <= 0) {
    return { periodStart: now, periodEnd: null, cancelAtPeriodEnd: false };
  }
  return {
    periodStart: now,
    periodEnd: new Date(now.getTime() + Math.trunc(months) * 30 * 86_400_000),
    cancelAtPeriodEnd: true,
  };
}
