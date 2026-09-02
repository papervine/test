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

// Test mode. The e2e suite runs a PRODUCTION build (`next build && next start`) so every
// route is compiled once up front instead of inside some test's 30s budget — that cold
// compile was the whole "passes locally, fails on the 4× slower CI runner" class of flake.
// But `next start` means NODE_ENV=production, and several affordances the specs depend on
// were gated on NODE_ENV: the dev reader sign-in on a JWT site, console email delivery (the
// password-reset spec reads its link there), the localhost trusted-origin wildcards, the
// secret-less cron routes. NODE_ENV alone can't say "production build, but a test": a
// self-hoster's `papervine serve` is NODE_ENV=production too and must get none of this.
// So the Playwright webServer sets PAPERVINE_TEST_MODE=1 and the gates ask isDevLike().
// Never set it in a real deployment. Takes `env` so it stays unit-testable.
//
// SERVER ONLY. `PAPERVINE_TEST_MODE` is deliberately not NEXT_PUBLIC_, so in a client
// component these read undefined and report "not a test" — which is why Sentry's client
// init reads the NEXT_PUBLIC_ spelling directly instead of calling this.
export function isTestMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PAPERVINE_TEST_MODE === "1";
}

export function isDevLike(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== "production" || isTestMode(env);
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
