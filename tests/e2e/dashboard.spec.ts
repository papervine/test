import { test, expect } from "@playwright/test";
import { TEST_USER } from "./constants";

// Logged in via the saved session (storageState).
test("dashboard greets the user and renders the rail", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: new RegExp(`Good (morning|afternoon|evening), ${TEST_USER.name.split(" ")[0]}`) }),
  ).toBeVisible();
  // The control-plane rail (nav + "Your sites"). No site-count / switcher-content
  // assertion — the suite shares one DB and other specs add/remove sites, so the rail's
  // top-left is sometimes the site switcher, sometimes the empty-state New-site link;
  // keep this spec order-independent.
  await expect(page.getByRole("link", { name: "Analytics" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your sites" })).toBeVisible();
});
