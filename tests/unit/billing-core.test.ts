// The pure billing decision layer (src/lib/billing/core.ts) — rating math, bucket
// consumption order, entitlement resolution (incl. the "no billing row => Free, never
// throw" rule the render path depends on), trial state, and catalog validation.
import { describe, expect, it } from "vitest";
import {
  CATALOG,
  FREE_ENTITLEMENTS,
  catalogPlan,
  parseCatalog,
  type CreditRateTable,
} from "@/lib/billing/catalog";
import {
  authorizeAiDecision,
  compGrantPeriod,
  overageCents,
  periodKey,
  planDebits,
  rateForModel,
  rateTokensToCredits,
  resolveEntitlements,
  hasFeature,
  trialStatus,
  trialEndDate,
  withinLimit,
  type SubscriptionState,
} from "@/lib/billing/core";

const TABLE: CreditRateTable = {
  version: 1,
  default: { inPer1M: 2000, outPer1M: 6000 },
  models: {
    "claude-haiku": { inPer1M: 400, outPer1M: 1200 },
    "claude-haiku-4-5": { inPer1M: 500, outPer1M: 1500 },
  },
};

describe("rateForModel", () => {
  it("longest prefix wins", () => {
    expect(rateForModel("claude-haiku-4-5-20251001", TABLE).inPer1M).toBe(500);
    expect(rateForModel("claude-haiku-3", TABLE).inPer1M).toBe(400);
  });
  it("unknown model falls back to default (a new model id must never throw)", () => {
    expect(rateForModel("gpt-next", TABLE)).toEqual(TABLE.default);
  });
  it("gateway provider prefixes rate as their bare family (same cost either route)", () => {
    expect(rateForModel("anthropic/claude-haiku-4.5", TABLE).inPer1M).toBe(400);
    expect(rateForModel("anthropic/claude-haiku-4-5-20251001", TABLE).inPer1M).toBe(500);
    expect(rateForModel("openai/gpt-next", TABLE)).toEqual(TABLE.default);
  });
  it("a provider-scoped key prices a whole route (self-hosted inference is free)", () => {
    const withLocal = {
      ...TABLE,
      models: { ...TABLE.models, "ollama/": { inPer1M: 0, outPer1M: 0 } },
    };
    expect(rateForModel("ollama/qwen3", withLocal)).toEqual({ inPer1M: 0, outPer1M: 0 });
    // …and the zero rate must survive the "nonzero usage floors at 1 credit" rule:
    // self-hosters pay nobody, so they're charged nothing.
    expect(
      rateTokensToCredits({ tokensIn: 500_000, tokensOut: 90_000, model: "ollama/qwen3" }, withLocal),
    ).toBe(0);
  });
});

describe("rateTokensToCredits", () => {
  it("rates a typical assistant answer (~3k in / 500 out) near the ~10-credit target", () => {
    const credits = rateTokensToCredits(
      { tokensIn: 3000, tokensOut: 500, model: "claude-sonnet-5" },
      TABLE,
    );
    expect(credits).toBe(9); // 3000*2000/1M = 6, 500*6000/1M = 3
  });
  it("ceils fractional work and floors nonzero usage at 1 credit", () => {
    expect(
      rateTokensToCredits({ tokensIn: 10, tokensOut: 0, model: "x" }, TABLE),
    ).toBe(1);
  });
  it("zero usage costs zero", () => {
    expect(rateTokensToCredits({ tokensIn: 0, tokensOut: 0, model: "x" }, TABLE)).toBe(0);
  });
  it("negative token counts are clamped, not credited back", () => {
    expect(
      rateTokensToCredits({ tokensIn: -500, tokensOut: 100, model: "x" }, TABLE),
    ).toBe(1);
  });
});

describe("planDebits (consumption order: trial -> monthly -> pack)", () => {
  const buckets = { trial: 100, monthly: 50, pack: 25 };

  it("draws from trial first", () => {
    expect(planDebits(buckets, 80, { overageEnabled: false })).toEqual({
      debits: [{ bucket: "trial", amount: 80 }],
      shortfall: 0,
      allowed: true,
    });
  });
  it("spills across buckets in order", () => {
    expect(planDebits(buckets, 160, { overageEnabled: false })).toEqual({
      debits: [
        { bucket: "trial", amount: 100 },
        { bucket: "monthly", amount: 50 },
        { bucket: "pack", amount: 10 },
      ],
      shortfall: 0,
      allowed: true,
    });
  });
  it("hard cap (default): refuses with NO debits when funds run out", () => {
    const plan = planDebits(buckets, 200, { overageEnabled: false });
    expect(plan.allowed).toBe(false);
    expect(plan.debits).toEqual([]);
    expect(plan.shortfall).toBe(25);
  });
  it("overage opt-in: shortfall extends the monthly bucket negative", () => {
    const plan = planDebits(buckets, 200, { overageEnabled: true });
    expect(plan.allowed).toBe(true);
    expect(plan.shortfall).toBe(25);
    expect(plan.debits).toContainEqual({ bucket: "monthly", amount: 25 + 50 });
    // packs/trial never go negative
    expect(plan.debits.find((d) => d.bucket === "pack")?.amount).toBe(25);
  });
  it("negative balances contribute nothing (already-overdrawn monthly)", () => {
    const plan = planDebits({ trial: 0, monthly: -40, pack: 30 }, 20, {
      overageEnabled: false,
    });
    expect(plan).toEqual({
      debits: [{ bucket: "pack", amount: 20 }],
      shortfall: 0,
      allowed: true,
    });
  });
  it("zero cost is a free pass", () => {
    expect(planDebits(buckets, 0, { overageEnabled: false }).allowed).toBe(true);
  });
});

describe("overageCents", () => {
  it("bills at cents-per-1000, rounding up", () => {
    expect(overageCents(1000, 800)).toBe(800); // $0.008/credit
    expect(overageCents(1, 800)).toBe(1);
    expect(overageCents(0, 800)).toBe(0);
  });
});

const now = new Date("2026-07-16T12:00:00Z");
const teamEnts = catalogPlan("team").entitlements;

function sub(over: Partial<SubscriptionState>): SubscriptionState {
  return { status: "active", trialEndsAt: null, entitlements: teamEnts, ...over };
}

describe("resolveEntitlements", () => {
  it("no billing row => Free (legacy orgs / DB-free paths must not throw or over-gate)", () => {
    expect(resolveEntitlements(null, now)).toBe(FREE_ENTITLEMENTS);
    expect(FREE_ENTITLEMENTS.features.assistant).toBe(false);
  });
  it("active keeps plan entitlements", () => {
    expect(resolveEntitlements(sub({}), now).features.sso).toBe(true);
  });
  it("past_due keeps entitlements (dunning is not a cutoff)", () => {
    expect(resolveEntitlements(sub({ status: "past_due" }), now).features.sso).toBe(true);
  });
  it("canceled collapses to Free", () => {
    expect(resolveEntitlements(sub({ status: "canceled" }), now)).toBe(FREE_ENTITLEMENTS);
  });
  it("live trial keeps trial entitlements; expired trial collapses to Free", () => {
    const trial = sub({
      status: "trialing",
      trialEndsAt: new Date("2026-07-20T00:00:00Z"),
      entitlements: catalogPlan("trial").entitlements,
    });
    expect(resolveEntitlements(trial, now).features.assistant).toBe(true);
    expect(
      resolveEntitlements({ ...trial, trialEndsAt: new Date("2026-07-01") }, now),
    ).toBe(FREE_ENTITLEMENTS);
  });
  it("hasFeature mirrors resolution", () => {
    expect(hasFeature(null, "assistant", now)).toBe(false);
    expect(hasFeature(sub({}), "assistant", now)).toBe(true);
  });
});

describe("authorizeAiDecision (the gate in front of every AI route)", () => {
  const buckets = { trial: 0, monthly: 100, pack: 0 };
  const okLookup = { state: "ok", sub: sub({}), buckets, overageEnabled: false } as const;

  it("DB error fails OPEN and unmetered — billing outages must not kill paid surfaces", () => {
    expect(authorizeAiDecision({ state: "error" }, "assistant", now)).toEqual({
      allowed: true,
      metered: false,
    });
  });
  it("no billing row gates like Free (AI features refused)", () => {
    expect(authorizeAiDecision({ state: "none" }, "assistant", now)).toEqual({
      allowed: false,
      code: "upgrade_required",
    });
  });
  it("plan without the feature -> upgrade_required (canceled sub collapses to Free)", () => {
    expect(
      authorizeAiDecision({ ...okLookup, sub: sub({ status: "canceled" }) }, "assistant", now),
    ).toEqual({ allowed: false, code: "upgrade_required" });
  });
  it("in-plan feature with credits -> allowed and metered", () => {
    expect(authorizeAiDecision(okLookup, "assistant", now)).toEqual({
      allowed: true,
      metered: true,
    });
  });
  it("drained buckets refuse with out_of_credits (hard cap default)", () => {
    const drained = { ...okLookup, buckets: { trial: 0, monthly: 0, pack: 0 } };
    expect(authorizeAiDecision(drained, "assistant", now)).toEqual({
      allowed: false,
      code: "out_of_credits",
    });
  });
  it("overage opt-in lets a drained org keep going", () => {
    const drained = {
      ...okLookup,
      buckets: { trial: 0, monthly: -5, pack: 0 },
      overageEnabled: true,
    };
    expect(authorizeAiDecision(drained, "assistant", now)).toEqual({
      allowed: true,
      metered: true,
    });
  });
  it("expired trial refuses even before the expiry cron runs", () => {
    const expired = {
      ...okLookup,
      buckets: { trial: 5000, monthly: 0, pack: 0 },
      sub: sub({
        status: "trialing" as const,
        trialEndsAt: new Date("2026-07-01"),
        entitlements: catalogPlan("trial").entitlements,
      }),
    };
    expect(authorizeAiDecision(expired, "assistant", now)).toEqual({
      allowed: false,
      code: "upgrade_required",
    });
  });
});

describe("withinLimit", () => {
  it("-1 means unlimited", () => {
    expect(withinLimit(-1, 10_000)).toBe(true);
    expect(withinLimit(3, 3)).toBe(false);
    expect(withinLimit(3, 2)).toBe(true);
  });
});

describe("trialStatus / trialEndDate", () => {
  it("counts days left, ceiling partial days", () => {
    const s = trialStatus(
      { status: "trialing", trialEndsAt: new Date("2026-07-18T18:00:00Z") },
      now,
    );
    expect(s).toEqual({
      state: "active",
      daysLeft: 3,
      endsAt: new Date("2026-07-18T18:00:00Z"),
    });
  });
  it("expired and non-trial states", () => {
    expect(
      trialStatus({ status: "trialing", trialEndsAt: new Date("2026-07-01") }, now).state,
    ).toBe("expired");
    expect(trialStatus({ status: "active", trialEndsAt: null }, now).state).toBe("none");
    expect(trialStatus(null, now).state).toBe("none");
  });
  it("trialEndDate applies the catalog's configured length", () => {
    const end = trialEndDate(now);
    expect(end.getTime() - now.getTime()).toBe(CATALOG.trial.days * 86_400_000);
  });
});

describe("compGrantPeriod (platform-admin plan comps)", () => {
  const now = new Date("2026-07-18T12:00:00Z");

  it("blank/zero/negative months → indefinite comp (no end, not cancel-at-period-end)", () => {
    for (const m of [null, 0, -3]) {
      const p = compGrantPeriod(now, m);
      expect(p.periodStart).toEqual(now);
      expect(p.periodEnd).toBeNull();
      expect(p.cancelAtPeriodEnd).toBe(false);
    }
  });

  it("positive months → time-boxed comp that lapses (cancel-at-period-end, ~N*30d out)", () => {
    const p = compGrantPeriod(now, 3);
    expect(p.periodStart).toEqual(now);
    expect(p.cancelAtPeriodEnd).toBe(true);
    expect(p.periodEnd).toEqual(new Date(now.getTime() + 3 * 30 * 86_400_000));
  });

  it("fractional months are truncated", () => {
    const p = compGrantPeriod(now, 2.9);
    expect(p.periodEnd).toEqual(new Date(now.getTime() + 2 * 30 * 86_400_000));
  });
});

describe("periodKey", () => {
  it("is UTC year-month", () => {
    expect(periodKey(new Date("2026-07-16T23:59:00Z"))).toBe("2026-07");
    expect(periodKey(new Date("2026-12-31T23:59:00Z"))).toBe("2026-12");
  });
});

describe("catalog", () => {
  it("the shipped catalog.json parses (bad edits fail here, not in checkout)", () => {
    expect(CATALOG.plans.length).toBeGreaterThanOrEqual(5);
    expect(CATALOG.trial).toEqual({
      days: 30,
      credits: 5000,
      planKey: "trial",
      representsPlanKey: "pro",
    });
  });
  it("locked pricing shape: Team $50/mo, Pro $300/mo, annual $40/$250-per-month equiv", () => {
    const cents = (plan: string, interval: string) =>
      CATALOG.prices.find((p) => p.planKey === plan && p.interval === interval)!
        .unitAmountCents;
    expect(cents("team", "month")).toBe(5000);
    expect(cents("team", "year")).toBe(40 * 12 * 100);
    expect(cents("pro", "month")).toBe(30000);
    expect(cents("pro", "year")).toBe(250 * 12 * 100);
  });
  it("credit pools: Team 5k, Pro 25k; Free has no AI and no overage path", () => {
    expect(catalogPlan("team").includedMonthlyCredits).toBe(5000);
    expect(catalogPlan("pro").includedMonthlyCredits).toBe(25000);
    expect(catalogPlan("free").includedMonthlyCredits).toBe(0);
    expect(catalogPlan("free").overageCentsPerThousandCredits).toBeNull();
    expect(catalogPlan("free").entitlements.features.assistant).toBe(false);
  });
  it("the wedge: SSO/RBAC start at Team, SCIM is Enterprise-only", () => {
    expect(catalogPlan("team").entitlements.features.sso).toBe(true);
    expect(catalogPlan("team").entitlements.features.rbac).toBe(true);
    expect(catalogPlan("team").entitlements.features.scim).toBe(false);
    expect(catalogPlan("pro").entitlements.features.scim).toBe(false);
    expect(catalogPlan("enterprise").entitlements.features.scim).toBe(true);
  });
  it("rejects malformed catalogs with a pointed error", () => {
    expect(() => parseCatalog({})).toThrow(/no plans/);
    const broken = structuredClone(CATALOG) as Record<string, unknown>;
    (broken.plans as { entitlements: { sites: unknown } }[])[0].entitlements.sites = 1.5;
    expect(() => parseCatalog(broken)).toThrow(/sites/);
    const dupe = structuredClone(CATALOG) as { plans: { key: string }[] };
    dupe.plans.push({ ...dupe.plans[0] });
    expect(() => parseCatalog(dupe)).toThrow(/duplicate/);
  });
});
