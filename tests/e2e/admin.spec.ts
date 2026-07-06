import { test, expect, type Page } from "@playwright/test";
import { TEST_USER, ORG_SLUG } from "./constants";

// Platform superadmin (SPEC §10.10). The webServer env allowlists
// platform-admin@papervine.test (playwright.config.ts) — deliberately NOT the shared
// TEST_USER, who must stay a plain customer here to prove the negative cases.
const ADMIN = {
  name: "Platform Admin",
  email: "platform-admin@papervine.test",
  password: "e2e-admin-password-123",
};

// ---- as the regular customer (shared storageState from auth.setup) ----

test("a signed-in non-admin gets a 404 from /admin (invisible surface)", async ({
  page,
}) => {
  const res = await page.goto("/admin");
  expect(res?.status()).toBe(404);
});

test("a non-admin's rail has no Platform Admin link", async ({ page }) => {
  await page.goto(`/${ORG_SLUG}/connect`);
  await expect(
    page.getByRole("heading", { name: "Connect a repository" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Platform Admin" })).toHaveCount(0);
});

// ---- as the platform admin (own session; no org membership at all) ----

// Sign the allowlisted admin in through the real UI. NOT page.request: that runs in
// Node, which can't resolve app.localhost (only Chromium maps *.localhost to loopback),
// and posting to 127.0.0.1 would set the session cookie on the wrong host. The first
// test of the suite run signs the account up (the DB is truncated per run); later tests
// hit "already exists" and fall back to sign-in. Either way an org-less user lands on
// /onboarding — /admin needs no org.
async function signInAsAdmin(page: Page) {
  await page.goto("/signup");
  await page.getByLabel("Name").fill(ADMIN.name);
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign up" }).click();
  const outcome = await Promise.race([
    page.waitForURL("**/onboarding").then(() => "signed-up"),
    page
      .getByText(/already exists/i)
      .waitFor()
      .then(() => "existing"),
  ]);
  if (outcome === "existing") {
    await page.goto("/login");
    await page.getByLabel("Email").fill(ADMIN.email);
    await page.getByLabel("Password").fill(ADMIN.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/onboarding");
  }
}

test.describe("platform admin", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.beforeEach(async ({ page }) => signInAsAdmin(page));

  test("/admin lists every customer org with members and totals", async ({
    page,
  }) => {
    await page.goto("/admin");
    await expect(
      page.getByRole("heading", { name: "Platform admin" }),
    ).toBeVisible();
    // The setup project's org + user appear even though the admin isn't a member.
    await expect(
      page.getByRole("heading", { name: TEST_USER.org }),
    ).toBeVisible();
    await expect(page.getByText(TEST_USER.email)).toBeVisible();
  });

  test("read-only bypass: a non-member admin can open any org's dashboard, marked by the banner", async ({
    page,
  }) => {
    await page.goto(`/${ORG_SLUG}`);
    await expect(page.getByText("Platform admin view")).toBeVisible();
    await expect(page.getByText(`you're not a member of`)).toBeVisible();
  });

  test("impersonate → browse as the customer → stop → back on /admin", async ({
    page,
  }) => {
    await page.goto("/admin");
    // The admin belongs to no org, so every impersonate control targets a customer;
    // TEST_USER is the only member the setup created.
    await page.getByRole("button", { name: "impersonate" }).first().click();

    // The action hard-navigates to the customer's dashboard as them.
    await expect(page.getByText(`Impersonating ${TEST_USER.name}`)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Stop impersonating" }),
    ).toBeVisible();
    // Their world, not the admin's: the org-scoped shell resolved TEST_USER's org.
    await expect(page).toHaveURL(new RegExp(`/${ORG_SLUG}(/|$)`));

    // Retry the click+navigation as a unit: right after the impersonation hard-nav the
    // banner button can be visible before React hydrates its onClick — a click that
    // lands in that window silently no-ops.
    await expect(async () => {
      await page.getByRole("button", { name: "Stop impersonating" }).click();
      await page.waitForURL(/\/admin$/, { timeout: 5_000 });
    }).toPass({ timeout: 30_000 });
    await expect(
      page.getByRole("heading", { name: "Platform admin" }),
    ).toBeVisible();
  });
});
