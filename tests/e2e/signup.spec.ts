import { test, expect } from "@playwright/test";

// The real signup → onboarding → create-organization → connect-chooser journey.
//
// This is the flow auth.setup used to drive for every run (and, since sharding, for every
// shard). It moved here so the suite's login is a seeded row plus a sign-in, and the real
// path is still exercised — once, on whichever shard picks this file up, off every other
// shard's critical path. If signup regresses, this is the test that goes red.
//
// Runs signed OUT: the chromium project loads the setup's storageState by default, and a
// signup page visited with a live session bounces to the dashboard (that redirect is itself
// covered in device-auth.spec).
test.use({ storageState: { cookies: [], origins: [] } });

// Distinct from TEST_USER in constants.ts on purpose. auth.setup seeds test@papervine.test
// and test-org; a second signup with those would collide on the unique email and slug, and
// the failure would read as "signup is broken" rather than "two tests want the same row".
const SIGNUP_USER = {
  name: "Signup Journey",
  email: "signup-journey@papervine.test",
  password: "e2e-signup-123",
  org: "Signup Journey Org",
  orgSlug: "signup-journey-org", // slugify(org)
};

test("a new account can sign up, create an organization, and land on the connect chooser", async ({
  page,
}) => {
  // Four cold route compiles on CI (signup, onboarding, the org action, connect). This is the
  // one test in the suite that is SUPPOSED to pay that, so it gets the budget outright.
  test.setTimeout(240_000);

  await page.goto("/signup");
  await page.getByLabel("Name").fill(SIGNUP_USER.name);
  await page.getByLabel("Email").fill(SIGNUP_USER.email);
  await page.getByLabel("Password").fill(SIGNUP_USER.password);
  await page.getByRole("button", { name: "Sign up", exact: true }).click();

  // No org yet → the resolver sends us to onboarding.
  await page.waitForURL("**/onboarding", { timeout: 90_000 });
  await page.getByLabel("Organization name").fill(SIGNUP_USER.org);
  await page.getByRole("button", { name: "Create organization" }).click();

  // Org but no site → the add-site chooser, with its first-run framing (SPEC §10.11).
  await page.waitForURL(`**/${SIGNUP_USER.orgSlug}/connect`, { timeout: 90_000 });
  await expect(
    page.getByRole("heading", { name: "Create your first site" }),
  ).toBeVisible();
});
