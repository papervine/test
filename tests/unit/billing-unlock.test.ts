// The unlock rule for plan-gated dashboard surfaces (src/lib/billing/unlock.ts). Every
// branch here is a product promise: self-hosters never see it, a billing outage never
// shows it to a paying customer, and the plan it names comes from the catalog.
import { describe, expect, it } from "vitest";
import { FREE_ENTITLEMENTS, CATALOG } from "@/lib/billing/catalog";
import type { BillingLookup } from "@/lib/billing/core";
import { planThatUnlocks, unlockDecision } from "@/lib/billing/unlock";

const now = new Date("2026-09-02T12:00:00Z");
const day = 86_400_000;

const plan = (key: string) => {
  const p = CATALOG.plans.find((x) => x.key === key);
  if (!p) throw new Error(`no plan ${key} in catalog`);
  return p;
};

function ok(
  status: "trialing" | "active" | "past_due" | "canceled",
  planKey: string,
  trialEndsAt: Date | null = null,
): BillingLookup {
  return {
    state: "ok",
    sub: { status, trialEndsAt, entitlements: plan(planKey).entitlements },
    buckets: { trial: 0, monthly: 100, pack: 0 },
    overageEnabled: false,
  };
}

describe("planThatUnlocks", () => {
  it("names the cheapest listed plan that includes the feature", () => {
    expect(planThatUnlocks("assistant")?.key).toBe("team");
    expect(planThatUnlocks("workflows")?.key).toBe("pro");
  });

  it("never names the trial (unlisted) or Free (which lacks the feature by definition)", () => {
    for (const f of ["assistant", "workflows"] as const) {
      const p = planThatUnlocks(f);
      expect(p?.listed).toBe(true);
      expect(p?.key).not.toBe("free");
      expect(p?.key).not.toBe("trial");
    }
  });

  it("names Enterprise for an Enterprise-only entitlement (it is listed, as contact-sales)", () => {
    expect(planThatUnlocks("scim")?.key).toBe("enterprise");
  });
});

describe("unlockDecision", () => {
  it("never locks when no billing backend is configured (self-hosted, CLI, CI)", () => {
    for (const lookup of [
      { state: "none" } as BillingLookup,
      { state: "error" } as BillingLookup,
      ok("canceled", "free"),
    ]) {
      for (const surface of ["automations", "agent", "assistant", "widget"] as const) {
        expect(unlockDecision({ configured: false, lookup, surface, now })).toEqual({
          locked: false,
        });
      }
    }
  });

  it("fails open on a billing lookup error, like authorizeAi", () => {
    expect(
      unlockDecision({ configured: true, lookup: { state: "error" }, surface: "assistant", now }),
    ).toEqual({ locked: false });
  });

  it("a customer Autumn has never seen is on the Free floor: assistant and automations lock", () => {
    const none: BillingLookup = { state: "none" };
    expect(FREE_ENTITLEMENTS.features.assistant).toBe(false);
    const a = unlockDecision({ configured: true, lookup: none, surface: "assistant", now });
    expect(a).toEqual({ locked: true, plan: { key: "team", name: plan("team").name }, trialEnded: false });
    const w = unlockDecision({ configured: true, lookup: none, surface: "automations", now });
    expect(w).toEqual({ locked: true, plan: { key: "pro", name: plan("pro").name }, trialEnded: false });
  });

  it("a live trial unlocks everything the trial grants", () => {
    const trial = ok("trialing", "trial", new Date(now.getTime() + 10 * day));
    for (const surface of ["automations", "agent", "assistant", "widget"] as const) {
      expect(unlockDecision({ configured: true, lookup: trial, surface, now }).locked).toBe(false);
    }
  });

  it("an ended trial locks, and says so", () => {
    const ended = ok("trialing", "trial", new Date(now.getTime() - 1 * day));
    const d = unlockDecision({ configured: true, lookup: ended, surface: "automations", now });
    expect(d.locked).toBe(true);
    if (d.locked) {
      expect(d.trialEnded).toBe(true);
      expect(d.plan?.key).toBe("pro");
    }
  });

  it("Team has the assistant (and its widget) but not automations or the agent", () => {
    const team = ok("active", "team");
    expect(unlockDecision({ configured: true, lookup: team, surface: "assistant", now }).locked).toBe(false);
    expect(unlockDecision({ configured: true, lookup: team, surface: "widget", now }).locked).toBe(false);
    const auto = unlockDecision({ configured: true, lookup: team, surface: "automations", now });
    expect(auto.locked).toBe(true);
    if (auto.locked) expect(auto.plan?.key).toBe("pro");
    expect(unlockDecision({ configured: true, lookup: team, surface: "agent", now }).locked).toBe(true);
  });

  it("past_due keeps access (dunning is not a feature gate); canceled is the Free floor", () => {
    expect(
      unlockDecision({ configured: true, lookup: ok("past_due", "pro"), surface: "automations", now })
        .locked,
    ).toBe(false);
    expect(
      unlockDecision({ configured: true, lookup: ok("canceled", "pro"), surface: "automations", now })
        .locked,
    ).toBe(true);
  });
});
