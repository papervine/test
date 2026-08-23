import { test, expect } from "@playwright/test";
import { ORG_SLUG } from "./constants";

// Logged in via storageState. Tagged @external — it hits the GitHub API to validate
// the repo, so CI can skip it (`--grep-invert @external`) to stay deterministic.
test("connect a public repo and land on its site overview @external", async ({ page }) => {
  await page.goto(`/${ORG_SLUG}/connect`);

  // The chooser preselects "Start from scratch" (SPEC §10.11), so pick the Git path first —
  // its fields only mount once its card is selected.
  await page.getByRole("radio", { name: /Connect a GitHub repo/ }).click();
  await page.getByLabel("Site name").fill("Starter E2E");
  await page.getByLabel("GitHub repository").fill("papervine/starter");
  await page.getByRole("button", { name: "Connect repository" }).click();

  // The action returns the new site's bare URL; the client hard-navigates there (slug is
  // slugify("Starter E2E") = "starter-e2e"). The overview shows the site + repo + Live.
  await page.waitForURL(`**/${ORG_SLUG}/starter-e2e`);
  await expect(page.getByRole("heading", { name: "Starter E2E" })).toBeVisible();
  await expect(page.getByRole("link", { name: /papervine\/starter/ })).toBeVisible();
  await expect(page.getByText("Live").first()).toBeVisible();
});
