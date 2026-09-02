// The SDK → documented-shape normaliser (src/lib/billing/autumn-keys.ts). Every read of an
// Autumn response goes through this, so its two properties are what the billing code relies
// on: camelCase keys become the REST spelling, and keys that ARE data — feature ids like
// `ai_credits` used as map keys, and the customer's own `metadata` — come through untouched.
import { describe, expect, it } from "vitest";
import { snakeCaseKeys } from "@/lib/billing/autumn-keys";

describe("snakeCaseKeys", () => {
  it("converts camelCase keys to snake_case, recursively, through arrays", () => {
    const out = snakeCaseKeys<Record<string, unknown>>({
      planId: "pro_trial",
      trialEndsAt: 1790909202512,
      subscriptions: [{ addOn: false, currentPeriodEnd: null }],
      variantDetails: { basePlanId: "team", customize: { price: { amount: 660 } } },
    });
    expect(out).toEqual({
      plan_id: "pro_trial",
      trial_ends_at: 1790909202512,
      subscriptions: [{ add_on: false, current_period_end: null }],
      variant_details: { base_plan_id: "team", customize: { price: { amount: 660 } } },
    });
  });

  it("leaves snake_case feature ids used as keys exactly as they are", () => {
    // `balances` and `flags` are keyed BY feature id. A converter that touched these would
    // break every `balances[AI_CREDITS_FEATURE]` lookup — with no error, just a missing key.
    const out = snakeCaseKeys<{ balances: Record<string, unknown>; flags: Record<string, unknown> }>({
      balances: { ai_credits: { remaining: 10 }, analytics_retention_days: { granted: 365 } },
      flags: { preview_deployments: { planId: "free" }, writer_agent: {} },
    });
    expect(Object.keys(out.balances)).toEqual(["ai_credits", "analytics_retention_days"]);
    expect(Object.keys(out.flags)).toEqual(["preview_deployments", "writer_agent"]);
    expect(out.flags.preview_deployments).toEqual({ plan_id: "free" });
  });

  it("does not rewrite the customer's own metadata keys", () => {
    const out = snakeCaseKeys<{ metadata: Record<string, unknown> }>({
      metadata: { githubOrg: "acme", nested: { keepMe: true } },
    });
    expect(out.metadata).toEqual({ githubOrg: "acme", nested: { keepMe: true } });
  });

  it("passes primitives, null and non-plain objects through", () => {
    const when = new Date("2026-09-01T00:00:00Z");
    expect(snakeCaseKeys(null)).toBeNull();
    expect(snakeCaseKeys(42)).toBe(42);
    expect(snakeCaseKeys("planId")).toBe("planId");
    expect(snakeCaseKeys<{ created_at: Date }>({ createdAt: when }).created_at).toBe(when);
  });

  it("handles digit boundaries the way the SDK spells them (pack5k stays pack5k)", () => {
    expect(snakeCaseKeys<Record<string, unknown>>({ pack5k: 1, maxPurchase: 2 })).toEqual({
      pack5k: 1,
      max_purchase: 2,
    });
  });
});
