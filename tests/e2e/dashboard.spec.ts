import { test, expect } from "@playwright/test";
import { TEST_USER } from "./constants";

// Logged in via the saved session (storageState).
test("dashboard greets the user and shows the org", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: new RegExp(`Good (morning|afternoon|evening), ${TEST_USER.name.split(" ")[0]}`) }),
  ).toBeVisible();
  // The org rail.
  await expect(page.getByText(TEST_USER.org)).toBeVisible();
  // Empty state until a repo is connected.
  await expect(page.getByText("No docs sites yet.")).toBeVisible();
});
