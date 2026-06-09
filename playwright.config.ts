import { defineConfig, devices } from "@playwright/test";
import { TEST_DB_URL } from "./tests/e2e/global-setup";

// E2E for the authed control plane (SPEC §10): real browser, real Postgres (papervine_test),
// real MinIO. The renderer/gate smoke gate (no DB) stays tests/smoke.mjs; pure logic is Vitest.
const PORT = 3210;

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  // Serialize: every spec shares one Postgres + one seeded org/user, so parallel
  // workers race on that state (a spec that adds a site would break another's
  // "no sites" assertion). One worker keeps DB state deterministic.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : "line",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
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
    command: `next dev -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // process.env wins over .env.local in Next, so this points the app at the test DB.
    env: {
      DATABASE_URL: TEST_DB_URL,
      BETTER_AUTH_SECRET: "e2e-only-deterministic-secret-do-not-use-in-production-0123456789",
      BETTER_AUTH_URL: `http://127.0.0.1:${PORT}`,
      S3_ENDPOINT: "http://127.0.0.1:9000",
      S3_REGION: "auto",
      S3_ACCESS_KEY_ID: "papervine",
      S3_SECRET_ACCESS_KEY: "papervinesecret",
      S3_BUCKET: "papervine-content",
    },
  },
});
