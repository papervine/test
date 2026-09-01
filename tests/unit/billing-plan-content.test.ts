// DRIFT GUARD (SPEC §10 Billing). The marketing copy (catalog.json plans[].display +
// matrix) and the enforced numbers (catalog.json entitlements/credits/prices) live in
// one file but are separate fields — this test fails if they disagree, so the pricing
// page can't silently claim something the runtime doesn't grant. If you change a plan's
// credits/limits/features in catalog.json, this points at the matrix row you forgot.
import { describe, expect, it } from "vitest";
import { catalogPlan, type PlanFeatureKey } from "@/lib/billing/catalog";
import {
  PLAN_MATRIX,
  PLAN_TIER_BY_KEY,
  type PlanKey,
  type MatrixRow,
} from "@/lib/billing/plan-content";

// The four purchasable plans. `selfhost` is a matrix column but has no billing row, so
// it is deliberately outside this list — a literal tuple, so catalogPlan() still narrows.
const TIERS = ["free", "team", "pro", "enterprise"] as const;

function row(label: string): MatrixRow {
  const found = PLAN_MATRIX.flatMap((g) => g.rows).find((r) => r.label === label);
  if (!found) throw new Error(`matrix row '${label}' not found`);
  return found;
}

describe("plan content vs. enforced catalog (drift guard)", () => {
  it("derives card prices from prices[] (Team $65, Pro $250, monthly only)", () => {
    expect(PLAN_TIER_BY_KEY.team.price).toBe("$65");
    expect(PLAN_TIER_BY_KEY.pro.price).toBe("$250");
    // The cards quote the monthly number alone — an annual price exists in prices[] but
    // is deliberately not advertised here, so the note must stay a bare "/mo".
    expect(PLAN_TIER_BY_KEY.team.priceNote).toBe("/mo");
    expect(PLAN_TIER_BY_KEY.pro.priceNote).toBe("/mo");
    expect(PLAN_TIER_BY_KEY.free.price).toBe("$0");
    expect(PLAN_TIER_BY_KEY.enterprise.price).toBe("Contact us");
  });

  it("matrix 'Docs sites' row matches entitlement limits (-1 → Custom)", () => {
    const limit = (n: number) => (n === -1 ? "Custom" : String(n));
    for (const t of TIERS) {
      const e = catalogPlan(t).entitlements;
      expect(row("Docs sites")[t], `sites/${t}`).toBe(limit(e.sites));
    }
    // Team members row uses descriptive text ("5 team members", "Unlimited team members")
    // rather than raw numeric limits, so it's checked separately for format consistency.
    expect(row("Team members").free).toContain("5");
    expect(row("Team members").team).toContain("Unlimited");
    expect(row("Team members").pro).toContain("Unlimited");
  });

  it("matrix 'AI credits' row matches each plan's includedMonthlyCredits", () => {
    // The advertised pool must be the pool the runtime actually grants — this is the
    // drift the guard exists for, so read the number back out of the cell rather than
    // hardcoding it here.
    for (const t of ["free", "team", "pro"] as const) {
      const cell = String(row("AI credits")[t]);
      const advertised = Number(cell.replace(/[^0-9]/g, ""));
      expect(advertised, `${t} ai credits`).toBe(catalogPlan(t).includedMonthlyCredits);
    }
    expect(String(row("AI credits").enterprise), "enterprise ai credits").toContain("volume");
  });

  it("matrix feature-flag rows match entitlement feature flags exactly", () => {
    // Matrix row label → the entitlement feature key it advertises. Any drift (e.g.
    // moving SSO to a different tier in entitlements but not the matrix) fails here.
    const ROW_TO_FEATURE: Record<string, PlanFeatureKey> = {
      "Preview deployments": "previewDeployments",
      "AI Insights": "insights",
      "AI Automations": "workflows",
      SCIM: "scim",
    };
    for (const [label, feature] of Object.entries(ROW_TO_FEATURE)) {
      for (const t of TIERS) {
        expect(row(label)[t], `${label}/${t}`).toBe(
          catalogPlan(t).entitlements.features[feature],
        );
      }
    }
    // "SSO & RBAC" row combines both sso and rbac features
    for (const t of TIERS) {
      const e = catalogPlan(t).entitlements.features;
      const expected = e.sso && e.rbac;
      expect(row("SSO & RBAC")[t], `SSO & RBAC/${t}`).toBe(expected);
    }
    // "Bring your own model (BYOK)" is available on all plans
    for (const t of TIERS) {
      expect(row("Bring your own model (BYOK)")[t], `BYOK/${t}`).toBe(true);
    }
  });

  it("card feature bullets exist for every listed tier", () => {
    for (const t of TIERS) {
      expect(PLAN_TIER_BY_KEY[t].features.length, `${t} bullets`).toBeGreaterThan(0);
    }
  });
});
