import { test, expect } from "@playwright/test";
import { TEST_USER } from "./constants";

// Logged in via the saved session (storageState).
test("dashboard greets the user and shows the org", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: new RegExp(`Good (morning|afternoon|evening), ${TEST_USER.name.split(" ")[0]}`) }),
  ).toBeVisible();
  // The org rail. (No site-count assertion — the suite shares one DB and the
  // connect spec may have added a site; keep this spec order-independent.)
  await expect(page.getByText(TEST_USER.org)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your sites" })).toBeVisible();
});
