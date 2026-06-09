import { test, expect } from "@playwright/test";

// Logged-out: the middleware gate must keep the control plane private.
test.use({ storageState: { cookies: [], origins: [] } });

test("unauthenticated /dashboard redirects to /login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Sign in to Papervine" })).toBeVisible();
});

test("unauthenticated /dashboard/connect redirects to /login", async ({ page }) => {
  await page.goto("/dashboard/connect");
  await expect(page).toHaveURL(/\/login$/);
});
