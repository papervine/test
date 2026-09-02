/**
 * The "unlock" decision for plan-gated surfaces (SPEC §10 Billing): when a dashboard page's
 * feature is not in the org's plan, the page shows what the feature is and which plan has
 * it instead of a working surface that would 403 on first use.
 *
 * PURE — no DB, no network — so the rule is unit-tested and the same on every surface. The
 * server-side entry point is `getUnlock` in ./store, which feeds this the billing lookup.
 *
 * The rule, in order:
 *   1. No billing backend configured (self-hosted, `npx papervine`, CI) → never locked.
 *      Billing is what gates features; an install without billing has nothing to sell and
 *      every surface simply works. This is the line the product promises self-hosters.
 *   2. Lookup failed (`error`) → not locked. Same fail-open stance as `authorizeAi`: a
 *      billing outage must not take a paid surface away from someone who paid for it.
 *   3. Otherwise resolve entitlements (a missing customer is the Free floor, an expired
 *      trial collapses to Free) and lock iff the feature is absent — naming the cheapest
 *      listed plan that includes it, read from the catalog so a tier change is a config
 *      edit, not a code edit.
 */
import { CATALOG, FREE_ENTITLEMENTS, type CatalogPlan, type PlanFeatureKey } from "./catalog";
import { resolveEntitlements, trialStatus, type BillingLookup } from "./core";

/** The dashboard surfaces that can be locked, and the entitlement each one needs. */
export const UNLOCKABLE = {
  automations: "workflows",
  // No separate flag for the agent: it is the same Pro-tier AI agent the automations run,
  // pointed at Slack, so it follows `workflows`. If it ever becomes its own SKU, add the
  // feature in Autumn (both environments) and to PlanFeatureKey, then change one line here.
  agent: "workflows",
  assistant: "assistant",
  // The widget is the assistant embedded elsewhere; same entitlement.
  widget: "assistant",
} as const satisfies Record<string, PlanFeatureKey>;
export type UnlockableSurface = keyof typeof UNLOCKABLE;

/** Cheapest listed plan whose entitlements include `feature` (Enterprise counts — it is listed as
 * contact-sales); null only if nothing listed includes it. */
export function planThatUnlocks(feature: PlanFeatureKey): CatalogPlan | null {
  const candidates = CATALOG.plans
    .filter((p) => p.listed && p.entitlements.features[feature])
    .sort((a, b) => a.sort - b.sort);
  return candidates[0] ?? null;
}

export type UnlockDecision =
  | { locked: false }
  | {
      locked: true;
      /** The plan to offer. Null when nothing listed includes the feature (Enterprise-only). */
      plan: { key: string; name: string } | null;
      /** True when the org HAD the feature through the trial and the trial has ended. */
      trialEnded: boolean;
    };

export function unlockDecision(input: {
  configured: boolean;
  lookup: BillingLookup;
  surface: UnlockableSurface;
  now: Date;
}): UnlockDecision {
  const feature = UNLOCKABLE[input.surface];
  if (!input.configured) return { locked: false };
  if (input.lookup.state === "error") return { locked: false };

  const sub = input.lookup.state === "ok" ? input.lookup.sub : null;
  const entitlements = sub ? resolveEntitlements(sub, input.now) : FREE_ENTITLEMENTS;
  if (entitlements.features[feature]) return { locked: false };

  const plan = planThatUnlocks(feature);
  return {
    locked: true,
    plan: plan ? { key: plan.key, name: plan.name } : null,
    trialEnded: sub ? trialStatus(sub, input.now).state === "expired" : false,
  };
}
