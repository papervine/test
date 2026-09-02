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
  // Playwright's per-assertion default is 5s, which is a RENDER budget. Almost every
  // assertion here waits on a server round trip — a form post through Better Auth (scrypt),
  // a Postgres write, an S3 read — on a CI runner about 4x slower than a dev machine, where
  // sibling tests in the same file were measured passing at 20.4s and 25.7s. Chasing that
  // one test at a time cost four separate fixes and still missed a fifth with the identical
  // shape, so the default now matches what the assertions actually wait for. `test.slow()`
  // does NOT raise this (it multiplies the TEST timeout), which is exactly why the two were
  // so easy to confuse: the test had budget left and the assertion did not.
  expect: { timeout: 15_000 },
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
    // A PRODUCTION build, not `next dev`. Dev compiled each route on first visit, inside
    // whichever test got there first — a few seconds here, the whole 30s budget on the ~4×
    // slower CI runner, which is where every "passes locally, ERR_ABORTED on CI" flake came
    // from (and the dev server's memory self-restarts and Turbopack dev-cache panics with it).
    // `next build` pays the compile once (~2 min on CI) and `next start` serves finished
    // output, so a test's budget is spent on the test. Dev-only affordances the specs need
    // come back via PAPERVINE_TEST_MODE below (src/lib/env.ts).
    //
    // The DB rebuild runs INSIDE the command, before the server boots — not in a
    // globalSetup hook, which Playwright runs AFTER starting the webServer (a rebuild
    // there drops the schema underneath the app's live pool + warm Next cache →
    // poisoned connections randomly 500 requests mid-suite). See tests/e2e/reset-db.mjs.
    command:
      `node tests/e2e/reset-db.mjs && ` +
      // The build gets the same cap as CI's own build job (6144); `next start` keeps the
      // smaller one below. The cap that mattered under `next dev` was the SERVER's, because
      // it compiled the whole app on demand while Chromium ran; a build peaks before any
      // browser launches, so licensing it more memory doesn't re-create the kernel OOM that
      // forced 6144 down to 3072 for the dev server.
      `NODE_OPTIONS=--max-old-space-size=6144 next build && ` +
      `next start -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    // Never reuse: a leftover server carries the previous run's pool + data cache (the
    // exact poisoning above) and skips the DB rebuild. If the port is busy, Playwright
    // errors — kill the stray server rather than inheriting its state.
    reuseExistingServer: false,
    // Covers the build (~35s here, ~2 min on CI) plus the DB rebuild and server boot.
    timeout: 600_000,
    // process.env wins over .env.local in Next, so this points the app at the test DB.
    env: {
      // V8's old-space cap for the SERVER phase (`next start`), and for reset-db. The build
      // overrides it upward in the command above.
      //
      // History worth keeping, because both failure modes were expensive: on CI the runner's
      // cgroup makes Node default to ~2GB, and under `next dev` — which compiled the whole app
      // on demand across the suite — that threshold triggered mid-run SELF-RESTARTS ("Server is
      // approaching the used memory threshold, restarting…"), each one a window where page.goto
      // hit ERR_CONNECTION_REFUSED and cascaded spec failures. Raising it to 6144 fixed that and
      // caused something nastier: a runner has ~8GB (measured — `free -m` on this job reported
      // 1257MB used / 6681MB available), so a 6GB license for the server alone, while Postgres,
      // MinIO, Chromium and Playwright shared the rest, let the KERNEL pick a victim — the job
      // died with `##[error]The operation was canceled.`, no failing spec, sometimes no
      // retrievable log, intermittently, on identical code. It read like a code regression and
      // cost a five-PR bisect to disprove. 3072 clears the cgroup default with room to spare and
      // leaves the box room to exist; a served build needs far less than a compiling one anyway.
      NODE_OPTIONS: "--max-old-space-size=3072",
      // Own build output, so the suite runs alongside `npm run dev` instead of fighting it
      // over `.next` (one dev server per distDir — see next.config.mjs). reset-db.mjs reads
      // the same value to check the right lock.
      NEXT_DIST_DIR: ".next-e2e",
      // The production build keeps its dev-only affordances (dev reader sign-in, console
      // email, localhost trusted origins, secret-less cron routes) and stays out of Sentry.
      // Both spellings: the server reads the bare one, the client bundle inlines NEXT_PUBLIC_.
      PAPERVINE_TEST_MODE: "1",
      NEXT_PUBLIC_PAPERVINE_TEST_MODE: "1",
      // Session recording is an optional integration like the rest: blanked so an operator who
      // has it configured doesn't record their own test runs (and doesn't get a different suite
      // from CI's). Sentry is handled by the flag above, which its three inits read.
      NEXT_PUBLIC_LOGROCKET_APP_ID: "",
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
      // Billing (SPEC §10): forwarded only when the operator exports it, otherwise blanked. Without
      // this line `next dev` reads .env.local's sandbox key on its own, so the APP had a billing
      // backend while the SPEC process (which loads no env file) believed there was none — and the
      // unlock spec, which pins "no backend → never locked", saw the seeded org locked to Free.
      AUTUMN_SECRET_KEY: process.env.AUTUMN_SECRET_KEY ?? "",
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
