// The Autumn → BillingLookup mapping (SPEC §10 Billing). Autumn is the billing source of
// truth, and this translation is where its shapes become the ones `authorizeAiDecision`
// already speaks. It gets its own test because every failure here is SILENT: a feature id
// that doesn't match reads as "not granted", which a paying customer experiences as an
// upgrade prompt, and nothing logs.
//
// FREE_CUSTOMER is a verbatim capture from the sandbox (a real getOrCreate response, Free
// auto-enabled) rather than a hand-written literal — a fixture we invented would encode
// what we *think* Autumn returns, which is the assumption under test.
import { describe, expect, it } from "vitest";
import { authorizeAiDecision } from "@/lib/billing/core";
import { lookupFromCustomer, type AutumnCustomer } from "@/lib/billing/autumn";

const now = new Date("2026-09-01T00:00:00Z");

const FREE_CUSTOMER = {
  subscriptions: [
    {
      plan_id: "free",
      auto_enable: true,
      add_on: false,
      status: "active",
      trial_ends_at: null,
    },
  ],
  balances: {
    ai_credits: { granted: 250, remaining: 250, usage: 0, unlimited: false, overage_allowed: false },
    sites: { granted: 1, remaining: 1, unlimited: false, overage_allowed: false },
    editors: { granted: 5, remaining: 5, unlimited: false, overage_allowed: false },
    analytics_retention_days: { granted: 7, remaining: 7, unlimited: false },
  },
  // Presence is the grant. Free carries these two and nothing else.
  flags: {
    preview_deployments: { plan_id: "free", feature_id: "preview_deployments" },
    writer_agent: { plan_id: "free", feature_id: "writer_agent" },
  },
} satisfies AutumnCustomer;

function ok(lookup: ReturnType<typeof lookupFromCustomer>) {
  if (lookup.state !== "ok") throw new Error(`expected ok, got ${lookup.state}`);
  return lookup;
}

describe("lookupFromCustomer", () => {
  it("maps the real Free customer payload to Free entitlements", () => {
    const { sub, buckets, overageEnabled } = ok(lookupFromCustomer(FREE_CUSTOMER));
    expect(sub.status).toBe("active");
    expect(sub.entitlements.sites).toBe(1);
    expect(sub.entitlements.editors).toBe(5);
    expect(sub.entitlements.analyticsRetentionDays).toBe(7);
    expect(buckets.monthly).toBe(250);
    expect(overageEnabled).toBe(false);
  });

  it("translates every camelCase entitlement key to its snake_case feature id", () => {
    // The two Free carries are true; the rest are absent and must read false — NOT
    // undefined, which would sneak past a truthiness check somewhere downstream.
    const { features } = ok(lookupFromCustomer(FREE_CUSTOMER)).sub.entitlements;
    expect(features.writerAgent).toBe(true);
    expect(features.previewDeployments).toBe(true);
    expect(features.assistant).toBe(false);
    expect(features.adminApis).toBe(false);
    expect(features.whiteLabel).toBe(false);
    for (const value of Object.values(features)) expect(typeof value).toBe("boolean");
  });

  it("reads a granted flag whose id differs from our key (admin_apis, white_label)", () => {
    // Guards the mapping table itself: these are the keys where a naive `key in flags`
    // would silently miss, because the two spellings differ.
    const { features } = ok(
      lookupFromCustomer({
        ...FREE_CUSTOMER,
        flags: {
          admin_apis: {},
          white_label: {},
          preview_deployments: {},
        },
      }),
    ).sub.entitlements;
    expect(features.adminApis).toBe(true);
    expect(features.whiteLabel).toBe(true);
    expect(features.previewDeployments).toBe(true);
  });

  it("maps unlimited to -1, the sentinel withinLimit() understands", () => {
    const { entitlements } = ok(
      lookupFromCustomer({
        ...FREE_CUSTOMER,
        balances: {
          ...FREE_CUSTOMER.balances,
          editors: { granted: 0, remaining: 0, unlimited: true },
        },
      }),
    ).sub;
    expect(entitlements.editors).toBe(-1);
  });

  it("an unlimited credit balance is spendable, not zero", () => {
    // `granted: 0, unlimited: true` is how Autumn says "no cap". Read literally it would
    // sum to 0 spendable credits and refuse every AI call with out_of_credits.
    const lookup = lookupFromCustomer({
      ...FREE_CUSTOMER,
      balances: {
        ...FREE_CUSTOMER.balances,
        ai_credits: { granted: 0, remaining: 0, unlimited: true },
      },
      flags: { ...FREE_CUSTOMER.flags, assistant: {} },
    });
    expect(ok(lookup).buckets.monthly).toBeGreaterThan(0);
    expect(authorizeAiDecision(lookup, "assistant", now)).toEqual({
      allowed: true,
      metered: true,
    });
  });

  it("ignores add-on subscriptions when picking the plan", () => {
    // A credit pack attaches ALONGSIDE the plan. Taking subscriptions[0] would read the
    // pack as the customer's plan and resolve entitlements from it.
    const { sub } = ok(
      lookupFromCustomer({
        ...FREE_CUSTOMER,
        subscriptions: [
          { plan_id: "pack_5k", add_on: true, status: "active" },
          ...FREE_CUSTOMER.subscriptions,
        ],
      }),
    );
    expect(sub.entitlements.sites).toBe(1); // Free's, not the pack's (which grants none)
  });

  it("a customer with no plan subscription is 'none' (Free), not an error", () => {
    expect(lookupFromCustomer({ subscriptions: [], balances: {}, flags: {} }).state).toBe("none");
    expect(lookupFromCustomer({}).state).toBe("none");
  });

  it("carries trial_ends_at through so the core's expiry backstop can fire", () => {
    const expired = lookupFromCustomer({
      ...FREE_CUSTOMER,
      subscriptions: [
        {
          plan_id: "pro_trial",
          add_on: false,
          status: "trialing",
          trial_ends_at: Date.parse("2026-08-01T00:00:00Z"),
        },
      ],
      flags: { ...FREE_CUSTOMER.flags, assistant: {} },
    });
    expect(ok(expired).sub.trialEndsAt).toEqual(new Date("2026-08-01T00:00:00Z"));
    // Autumn should have swept this already; if it hasn't, we collapse to Free rather
    // than serving a lapsed trial's entitlements.
    expect(authorizeAiDecision(expired, "assistant", now)).toEqual({
      allowed: false,
      code: "upgrade_required",
    });
  });

  it("an unrecognized status degrades to active rather than throwing", () => {
    expect(
      ok(lookupFromCustomer({
        ...FREE_CUSTOMER,
        subscriptions: [{ plan_id: "free", add_on: false, status: "something_new" }],
      })).sub.status,
    ).toBe("active");
  });
});
