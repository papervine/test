// Which deployment we're running in. On Vercel, VERCEL_ENV is the source of truth
// ("production" | "preview" | "development"); locally it's unset, so we fall back to
// NODE_ENV and treat anything that isn't a real Vercel prod build as non-prod. Pure
// and dependency-free so it's unit-testable (tests/unit/env.test.ts).
export type DeployEnv = "production" | "preview" | "development";

export function resolveDeployEnv(
  vercelEnv: string | undefined,
  nodeEnv: string | undefined,
): DeployEnv {
  if (vercelEnv === "production") return "production";
  if (vercelEnv === "preview") return "preview";
  if (vercelEnv === "development") return "development";
  // No VERCEL_ENV → not a Vercel deploy. A local `next build && start` sets
  // NODE_ENV=production but is still not real prod, so only true Vercel prod hides
  // the badge. Anything else (local dev, local prod build) reads as development.
  void nodeEnv;
  return "development";
}

// What the corner marker should say — or null where there shouldn't be one. The label
// is intentionally short; EnvBadge appends the git branch for previews.
//
// Only PREVIEW gets a marker. A preview URL looks exactly like production and is the
// one you can mistake for it; running locally you already know, and the badge is
// pinned top-right, which is where the editor keeps Publish — so it sat on top of the
// control it was least helpful next to.
export function envBadge(
  env: DeployEnv,
): { label: string; variant: "local" | "preview" } | null {
  return env === "preview" ? { label: "preview", variant: "preview" } : null;
}
