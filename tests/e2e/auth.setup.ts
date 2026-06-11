import { test as setup, expect } from "@playwright/test";
import { TEST_USER, ORG_SLUG } from "./constants";

const authFile = "tests/e2e/.auth/user.json";

// Create the seeded user through the real signup → onboarding flow, then save the
// session so the rest of the suite starts already logged in (Playwright storageState).
// globalSetup truncated the DB, so this email is free each run. Runs on the app host
// (baseURL) — the control plane (SPEC §10).
setup("authenticate", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Name").fill(TEST_USER.name);
  await page.getByLabel("Email").fill(TEST_USER.email);
  await page.getByLabel("Password").fill(TEST_USER.password);
  await page.getByRole("button", { name: "Sign up" }).click();

  // No org yet → the resolver sends us to onboarding.
  await page.waitForURL("**/onboarding");
  await page.getByLabel("Organization name").fill(TEST_USER.org);
  await page.getByRole("button", { name: "Create organization" }).click();

  // Org but no site yet → the resolver lands on the connect form at /:org/connect.
  await page.waitForURL(`**/${ORG_SLUG}/connect`);
  await expect(
    page.getByRole("heading", { name: "Connect a repository" }),
  ).toBeVisible();

  await page.context().storageState({ path: authFile });
});
