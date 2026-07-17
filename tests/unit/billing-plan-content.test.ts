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

const TIERS: PlanKey[] = ["free", "team", "pro", "enterprise"];

function row(label: string): MatrixRow {
  const found = PLAN_MATRIX.flatMap((g) => g.rows).find((r) => r.label === label);
  if (!found) throw new Error(`matrix row '${label}' not found`);
  return found;
}

describe("plan content vs. enforced catalog (drift guard)", () => {
  it("derives card prices from prices[] (Team $50, Pro $300, annual $40/$250)", () => {
    expect(PLAN_TIER_BY_KEY.team.price).toBe("$50");
    expect(PLAN_TIER_BY_KEY.team.priceNote).toContain("$40/mo billed annually");
    expect(PLAN_TIER_BY_KEY.pro.price).toBe("$300");
    expect(PLAN_TIER_BY_KEY.pro.priceNote).toContain("$250/mo billed annually");
    expect(PLAN_TIER_BY_KEY.free.price).toBe("$0");
    expect(PLAN_TIER_BY_KEY.enterprise.price).toBe("Contact us");
  });

  it("matrix 'Docs sites' / 'Editors' rows match entitlement limits (-1 → Custom)", () => {
    const limit = (n: number) => (n === -1 ? "Custom" : String(n));
    for (const t of TIERS) {
      const e = catalogPlan(t).entitlements;
      expect(row("Docs sites")[t], `sites/${t}`).toBe(limit(e.sites));
      expect(row("Editors")[t], `editors/${t}`).toBe(limit(e.editors));
    }
  });

  it("matrix 'AI credits' row reflects each plan's included monthly credits", () => {
    // Paid plans state the exact number; free/enterprise are editorial (trial/committed).
    for (const t of ["team", "pro"] as const) {
      const credits = catalogPlan(t).includedMonthlyCredits;
      expect(String(row("AI credits")[t]), `credits/${t}`).toContain(
        credits.toLocaleString(),
      );
    }
  });

  it("matrix feature-flag rows match entitlement feature flags exactly", () => {
    // Matrix row label → the entitlement feature key it advertises. Any drift (e.g.
    // moving SSO to a different tier in entitlements but not the matrix) fails here.
    const ROW_TO_FEATURE: Record<string, PlanFeatureKey> = {
      Assistant: "assistant",
      "Writing agent": "writerAgent",
      Workflows: "workflows",
      "Admin APIs": "adminApis",
      "Advanced insights": "advancedInsights",
      "Multi-repo": "multiRepo",
      "Preview deployments": "previewDeployments",
      "Role-based permissions": "rbac",
      "Dashboard SSO": "sso",
      SCIM: "scim",
    };
    for (const [label, feature] of Object.entries(ROW_TO_FEATURE)) {
      for (const t of TIERS) {
        expect(row(label)[t], `${label}/${t}`).toBe(
          catalogPlan(t).entitlements.features[feature],
        );
      }
    }
  });

  it("card feature bullets exist for every listed tier", () => {
    for (const t of TIERS) {
      expect(PLAN_TIER_BY_KEY[t].features.length, `${t} bullets`).toBeGreaterThan(0);
    }
  });
});
