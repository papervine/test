import { defineConfig, devices } from "@playwright/test";
import { TEST_DB_URL } from "./tests/e2e/global-setup";
import { TEST_S3 } from "./tests/e2e/constants";

// E2E for the authed control plane (SPEC §10): real browser, real Postgres (papervine_test),
// real MinIO. The renderer/gate smoke gate (no DB) stays tests/smoke.mjs; pure logic is Vitest.
const PORT = 3210;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  // Serialize: every spec shares one Postgres + one seeded org/user, so parallel
  // workers race on that state (a spec that adds a site would break another's
  // "no sites" assertion). One worker keeps DB state deterministic.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : "line",
  use: {
    // The control plane lives on the app host (SPEC §10) at bare /:org/:site — point the
    // suite there so its relative paths are the real dashboard URLs. `app.localhost`
    // resolves to loopback (where the webServer listens). Tenant-docs specs address the
    // apex absolutely (APEX_ORIGIN in constants).
    baseURL: `http://app.localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    // Logs in (via the real signup → onboarding flow) and saves the session for reuse.
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "tests/e2e/.auth/user.json" },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    // The DB rebuild runs INSIDE the command, before `next dev` boots — not in a
    // globalSetup hook, which Playwright runs AFTER starting the webServer (a rebuild
    // there drops the schema underneath the app's live pool + warm Next cache →
    // poisoned connections randomly 500 requests mid-suite). See tests/e2e/reset-db.mjs.
    command: `node tests/e2e/reset-db.mjs && next dev -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    // Never reuse: a leftover server carries the previous run's pool + data cache (the
    // exact poisoning above) and skips the DB rebuild. If the port is busy, Playwright
    // errors — kill the stray server rather than inheriting its state.
    reuseExistingServer: false,
    timeout: 120_000,
    // process.env wins over .env.local in Next, so this points the app at the test DB.
    env: {
      // Raise V8's old-space cap for the dev server. On CI the runner's cgroup makes Node
      // default to ~2GB; `next dev` compiling the whole app on-demand across the suite crosses
      // its memory threshold and SELF-RESTARTS mid-run ("Server is approaching the used memory
      // threshold, restarting…"), and each restart is a brief window where page.goto hits
      // ERR_CONNECTION_REFUSED and cascades spec failures. Same fix the CI build step already uses.
      // 6144 was too generous, and the failure it caused is nastier than the one it fixed: a CI
      // runner has ~8GB (measured — `free -m` on the e2e job reported 1257MB used / 6681MB
      // available), and this cap licenses the dev server alone to take 6GB of it while Postgres,
      // MinIO, Chromium and the Playwright process share what's left. When the peak compile (the
      // marketing home, which pulls the whole editor bundle) landed near the ceiling, the KERNEL
      // picked a victim: the job died with `##[error]The operation was canceled.`, no failing spec,
      // no output, and once with no retrievable log at all — intermittently, on identical code, so
      // it read like a code regression and cost a five-PR bisect to disprove. 3072 still comfortably
      // clears the ~2GB cgroup default that caused the self-restarts this cap was added for, and
      // leaves the rest of the box room to exist.
      NODE_OPTIONS: "--max-old-space-size=3072",
      // Own build output, so the suite runs alongside `npm run dev` instead of fighting it
      // over `.next` (one dev server per distDir — see next.config.mjs). reset-db.mjs reads
      // the same value to check the right lock.
      NEXT_DIST_DIR: ".next-e2e",
      // Forwarded so the GitHub App surfaces render their real shape. Without the client
      // credentials the hosted→Git page shows only its existing-repo view, and a spec
      // asserting the one-click choice would silently skip the thing it tests.
      //
      // Note the tension with the auth-isolation rule below: this same pair now also lights
      // "Continue with GitHub" on /login and /signup (SPEC §10.1), so forwarding it makes the
      // auth pages differ from CI's on a machine that exports it. Accepted rather than blanked
      // — blanking would hollow out the one-click spec this forward exists for, GitHub sign-in
      // makes no outbound call until the button is clicked (unlike Resend), and the auth specs
      // match "Sign in"/"Sign up" exactly, which an "…with GitHub" label doesn't collide with.
      ...(process.env.GITHUB_APP_CLIENT_ID
        ? { GITHUB_APP_CLIENT_ID: process.env.GITHUB_APP_CLIENT_ID }
        : {}),
      ...(process.env.GITHUB_APP_CLIENT_SECRET
        ? { GITHUB_APP_CLIENT_SECRET: process.env.GITHUB_APP_CLIENT_SECRET }
        : {}),
      DATABASE_URL: TEST_DB_URL,
      BETTER_AUTH_SECRET: "e2e-only-deterministic-secret-do-not-use-in-production-0123456789",
      // Auth happens on the app host — trust that origin (Better Auth's CSRF check reads
      // BETTER_AUTH_URL into trustedOrigins).
      BETTER_AUTH_URL: `http://app.localhost:${PORT}`,
      // Shared with the specs that seed storage directly (tests/e2e/constants.ts) — see
      // TEST_S3 there for why these can't be duplicated per-spec.
      S3_ENDPOINT: TEST_S3.endpoint,
      S3_REGION: TEST_S3.region,
      S3_ACCESS_KEY_ID: TEST_S3.accessKeyId,
      S3_SECRET_ACCESS_KEY: TEST_S3.secretAccessKey,
      S3_BUCKET: TEST_S3.bucket,
      // Deterministic GitHub App webhook secret so the push-webhook spec can sign payloads
      // the running server will verify (SPEC §3 auto-sync). Test-only.
      GITHUB_APP_WEBHOOK_SECRET: "e2e-webhook-secret",
      // The default e2e run is executor-free BY CONTRACT (SPEC §10.2 isolation rule):
      // automations must degrade to the "Executor not configured" state. An operator's
      // .env.local may carry a real TRIGGER_SECRET_KEY — blank it so the suite behaves
      // identically on a configured dev machine and in CI (empty string is falsy for
      // isExecutorConfigured).
      TRIGGER_SECRET_KEY: "",
      // Same isolation rule for the optional auth integrations (SPEC §11.1). An operator who
      // has configured Google sign-in or Resend in .env.local would otherwise get a DIFFERENT
      // suite than CI: an extra "Continue with Google" button (which broke the exact-match
      // "Sign up" selectors), and — worse — a signup that makes a REAL outbound Resend call,
      // because Better Auth awaits sendVerificationEmail before returning. That turned signup
      // into a network-bound operation and hung the password-reset spec. Blank them so email
      // falls back to console logging, which is what the reset spec reads its token around.
      RESEND_API_KEY: "",
      EMAIL_FROM: "",
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
      // Same isolation rule for AI (SPEC §8). CI has no provider, so every assistant surface
      // answers 503 "not configured" there; an operator with a key in .env.local was getting a
      // DIFFERENT suite — real model calls, real latency, and a widget that answered instead of
      // refusing. That divergence is exactly what let the home-demo chip spec pass locally and
      // fail twice in CI. Blank them so both run the refusal path, which is also the fast one.
      PAPERVINE_AI_MODEL: "",
      AI_GATEWAY_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      OPENAI_API_KEY: "",
      GOOGLE_GENERATIVE_AI_API_KEY: "",
      // Platform superadmin allowlist (SPEC §10.10) for admin.spec.ts. Deliberately NOT
      // TEST_USER's email: the shared storageState user must stay a plain customer so the
      // admin rail link / bypass never leaks into the other specs' assertions. The admin
      // spec signs this account up itself.
      PLATFORM_ADMIN_EMAILS: "platform-admin@papervine.test",
      // Opt-in collaboration: when the operator exports NEXT_PUBLIC_COLLAB_URL (and runs
      // apps/collab), forward it + the shared secret so the app connects to the real socket
      // service and the gated remote-caret spec in editor.spec.ts can run. Unset → skipped.
      ...(process.env.NEXT_PUBLIC_COLLAB_URL
        ? {
            NEXT_PUBLIC_COLLAB_URL: process.env.NEXT_PUBLIC_COLLAB_URL,
            COLLAB_JWT_SECRET: process.env.COLLAB_JWT_SECRET ?? "papervine-collab-dev-secret",
          }
        : {}),
    },
  },
});
