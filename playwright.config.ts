import { defineConfig, devices } from "@playwright/test";
import { TEST_DB_URL } from "./tests/e2e/global-setup";

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
      DATABASE_URL: TEST_DB_URL,
      BETTER_AUTH_SECRET: "e2e-only-deterministic-secret-do-not-use-in-production-0123456789",
      // Auth happens on the app host — trust that origin (Better Auth's CSRF check reads
      // BETTER_AUTH_URL into trustedOrigins).
      BETTER_AUTH_URL: `http://app.localhost:${PORT}`,
      S3_ENDPOINT: "http://127.0.0.1:9000",
      S3_REGION: "auto",
      S3_ACCESS_KEY_ID: "papervine",
      S3_SECRET_ACCESS_KEY: "papervinesecret",
      S3_BUCKET: "papervine-content",
      // Deterministic GitHub App webhook secret so the push-webhook spec can sign payloads
      // the running server will verify (SPEC §3 auto-sync). Test-only.
      GITHUB_APP_WEBHOOK_SECRET: "e2e-webhook-secret",
      // Platform superadmin allowlist (SPEC §10.10) for admin.spec.ts. Deliberately NOT
      // TEST_USER's email: the shared storageState user must stay a plain customer so the
      // admin rail link / bypass never leaks into the other specs' assertions. The admin
      // spec signs this account up itself.
      PLATFORM_ADMIN_EMAILS: "platform-admin@papervine.test",
    },
  },
});
