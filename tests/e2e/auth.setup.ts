import { test as setup, expect } from "@playwright/test";
import { TEST_USER, ORG_SLUG } from "./constants";

const authFile = "tests/e2e/.auth/user.json";

// Create the seeded user through the real signup → onboarding flow, then save the
// session so the rest of the suite starts already logged in (Playwright storageState).
// reset-db.mjs rebuilt the DB before the server booted, so this email is free each
// run. Runs on the app host
// (baseURL) — the control plane (SPEC §10).
setup("authenticate", async ({ page }) => {
  // MEASURED, not guessed: this took **1.4 minutes on a green CI run of `main`** against
  // the 90s that `setup.slow()` buys (3× the 30s default). A six-second margin on the one
  // test that gates the entire suite — every other spec depends on the storageState it
  // writes, so when this loses the coin flip the whole run reports as broken.
  //
  // It is expensive for a real reason: signup → onboarding → org create → the connect
  // chooser cold-compiles four route trees under `next dev`, and CI is ~4× slower than a
  // dev machine. So the budget is set explicitly and generously rather than as a multiple
  // of a default that was never chosen with this path in mind. If it ever genuinely needs
  // four minutes, something is wrong and a timeout is the right way to hear about it.
  setup.setTimeout(240_000);
  await page.goto("/signup");
  await page.getByLabel("Name").fill(TEST_USER.name);
  await page.getByLabel("Email").fill(TEST_USER.email);
  await page.getByLabel("Password").fill(TEST_USER.password);
  await page.getByRole("button", { name: "Sign up", exact: true }).click();

  // Each wait carries its own budget so a failure names the step that ran out. Without
  // them the whole test just reports "timeout", and the first symptom is worse than
  // useless: a navigation aborted by the expiring test clock surfaces as
  // `net::ERR_ABORTED; maybe frame was detached?`, which reads as a crashed page.
  // No org yet → the resolver sends us to onboarding.
  await page.waitForURL("**/onboarding", { timeout: 90_000 });
  await page.getByLabel("Organization name").fill(TEST_USER.org);
  await page.getByRole("button", { name: "Create organization" }).click();

  // Org but no site yet → the resolver lands on the add-site chooser at /:org/connect,
  // which shows its first-run framing for a site-less org (SPEC §10.11).
  await page.waitForURL(`**/${ORG_SLUG}/connect`, { timeout: 90_000 });
  await expect(
    page.getByRole("heading", { name: "Create your first site" }),
  ).toBeVisible();

  await page.context().storageState({ path: authFile });
});
