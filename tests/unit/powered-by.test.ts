import { describe, it, expect } from "vitest";
import { showsPoweredByBadge } from "@/lib/powered-by";
import { PLAN_FEATURE_KEYS, type PlanFeatureKey } from "@/lib/billing/catalog";
import catalog from "@/lib/billing/catalog.json";

/** Every flag off except the ones named — the shape a published plan version actually stores. */
function features(...on: PlanFeatureKey[]): Record<PlanFeatureKey, boolean> {
  return Object.fromEntries(PLAN_FEATURE_KEYS.map((k) => [k, on.includes(k)])) as Record<
    PlanFeatureKey,
    boolean
  >;
}

describe("showsPoweredByBadge", () => {
  it("hides it when the plan is entitled to white labelling", () => {
    expect(showsPoweredByBadge({ planKey: "enterprise", features: features("whiteLabel") })).toBe(
      false,
    );
  });

  it("shows it on every plan that isn't", () => {
    for (const planKey of ["free", "team", "pro", "trial"] as const) {
      expect(showsPoweredByBadge({ planKey, features: features() }), planKey).toBe(true);
    }
  });

  it("shows it for an org with no billing row at all — that's Free, not an error", () => {
    expect(showsPoweredByBadge({ planKey: null, features: null })).toBe(true);
  });

  it("keeps it off Enterprise for versions pinned before the flag existed", () => {
    // A subscription stays on the version it was bought on until the next publish, so an
    // Enterprise customer can legitimately have entitlements with no `whiteLabel` key. Reading
    // that as false would put the badge on the docs they pay to keep unbranded.
    const old = { sites: 10, editors: 10, analyticsRetentionDays: 365 } as never;
    expect(showsPoweredByBadge({ planKey: "enterprise", features: old })).toBe(false);
    expect(showsPoweredByBadge({ planKey: "pro", features: old })).toBe(true);
  });

  it("the entitlement is explicitly present on every plan in the catalog", () => {
    // Guards the gap the fallback above exists to cover: once published, no plan should be
    // relying on it.
    for (const plan of catalog.plans) {
      expect(
        (plan.entitlements.features as Record<string, boolean>).whiteLabel,
        plan.key,
      ).toBeTypeOf("boolean");
    }
  });

  it("only Enterprise has it, so the badge is on every self-serve tier", () => {
    const white = catalog.plans
      .filter((p) => (p.entitlements.features as Record<string, boolean>).whiteLabel)
      .map((p) => p.key);
    expect(white).toEqual(["enterprise"]);
  });
});
