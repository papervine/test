import { test, expect } from "@playwright/test";
import { ORG_SLUG } from "./constants";

// Logged-out: the app-host edge gate must keep the control plane private. baseURL is the
// app host (SPEC §10), so these bare paths are the real dashboard URLs.
test.use({ storageState: { cookies: [], origins: [] } });

test("unauthenticated app host / redirects to /login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Sign in to Papervine" })).toBeVisible();
});

test("unauthenticated /:org/:site redirects to /login", async ({ page }) => {
  await page.goto(`/${ORG_SLUG}/some-site`);
  await expect(page).toHaveURL(/\/login$/);
});

test("unauthenticated /:org/connect redirects to /login", async ({ page }) => {
  await page.goto(`/${ORG_SLUG}/connect`);
  await expect(page).toHaveURL(/\/login$/);
});
