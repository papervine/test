import type { PlanFeatureKey, PlanKey } from "./billing/catalog";

/**
 * Whether a tenant docs site shows the "Powered by Papervine" badge.
 *
 * Expressed as a plan ENTITLEMENT (`whiteLabel`) rather than a `planKey === "enterprise"`
 * comparison, because that's how every other plan difference in this codebase is expressed: it
 * goes through catalog.json → `billing:sync` → `billing:publish`, so moving the badge to Pro
 * later is a catalog edit and a republish rather than a deploy.
 *
 * Pure and free of `server-only` so it can be unit-tested directly; the DB read and the caching
 * live in `powered-by-store.ts`.
 */
export function showsPoweredByBadge(input: {
  /** The plan the org's pinned version belongs to, or null when there's no billing row. */
  planKey: PlanKey | null;
  /** The pinned version's feature flags, or null when there's no billing row. */
  features: Partial<Record<PlanFeatureKey, boolean>> | null;
}): boolean {
  const whiteLabel = input.features?.whiteLabel;

  // The normal path once the catalog carrying this key has been published.
  if (typeof whiteLabel === "boolean") return !whiteLabel;

  // A version pinned BEFORE `whiteLabel` existed has no such key, and a subscription keeps the
  // version it was created with until the next publish. Reading `undefined` as falsy would put
  // the badge on an existing Enterprise customer's white-labelled docs — the one thing they are
  // paying for it not to say — so fall back to the plan key for exactly that window.
  return input.planKey !== "enterprise";
}
