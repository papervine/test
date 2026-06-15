// Feature visibility config — the one place to turn surfaces on/off. Flip a value,
// commit, deploy: no env vars, no DB, no vendor. Each feature names an *audience*, so
// one value answers both "is it on?" and "who sees it?":
//   "off"      → fully dark (still in code, nobody sees it)
//   "admin"    → org owners/admins only (dogfood a surface before launch)
//   "everyone" → shipped
//
// `canSee` is pure so it unit-tests in isolation (tests/unit/features.test.ts) and is
// shared by the nav (AppRail, cosmetic hide) AND the route gate (automate/layout.tsx,
// real access control — hiding a link is not gating the URL).
export type Audience = "off" | "admin" | "everyone";

export const FEATURES = {
  // The Automate section is scaffolded UI only (SPEC §10.2) — keep it to admins until
  // each surface is actually wired up, then bump to "everyone".
  "automate.workflows": "admin",
  "automate.agent": "admin",
  "automate.assistant": "admin",
  // The web editor + authoring backend (SPEC §9.2/§10). Admin-only while we dogfood the
  // write path; bump to "everyone" once it's hardened (RBAC ≥ editor in SPEC terms).
  "editor.workspace": "admin",
} satisfies Record<string, Audience>;

export type FeatureKey = keyof typeof FEATURES;

// Better Auth's organization plugin issues roles owner | admin | member; the "admin"
// audience means the elevated two. A null role (no membership) never clears an "admin"
// gate.
export function canSee(audience: Audience, role: string | null | undefined): boolean {
  if (audience === "off") return false;
  if (audience === "everyone") return true;
  return role === "owner" || role === "admin";
}

// Convenience for the common case: look a feature up by key. Unknown keys default to
// visible, so a surface only hides when something explicitly lists it in FEATURES.
export function canSeeFeature(
  key: FeatureKey,
  role: string | null | undefined,
): boolean {
  return canSee(FEATURES[key], role);
}
