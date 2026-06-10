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

// What the corner marker should say — or null in real production (no marker). The
// label is intentionally short; EnvBadge appends the git branch for previews.
export function envBadge(
  env: DeployEnv,
): { label: string; variant: "local" | "preview" } | null {
  if (env === "production") return null;
  if (env === "preview") return { label: "preview", variant: "preview" };
  return { label: "local", variant: "local" };
}
