import { test, expect } from "@playwright/test";

// Logged in via storageState. Tagged @external — it hits the GitHub API to validate
// the repo, so CI can skip it (`--grep-invert @external`) to stay deterministic.
test("connect a public repo and see it on the dashboard @external", async ({ page }) => {
  await page.goto("/dashboard/connect");

  await page.getByLabel("Site name").fill("Starter E2E");
  await page.getByLabel("GitHub repository").fill("papervine/starter");
  await page.getByRole("button", { name: "Connect repository" }).click();

  // Redirects home; the new site card (a link) + an activity row appear.
  await page.waitForURL("**/dashboard");
  const card = page.getByRole("link", { name: /Starter E2E/ });
  await expect(card).toBeVisible();
  await expect(card).toContainText("papervine/starter");
  await expect(page.getByText("Live").first()).toBeVisible();
});
