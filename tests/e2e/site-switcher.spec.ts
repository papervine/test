import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { TEST_DB_URL } from "./global-setup";

// The top-left site switcher (SPEC §10): selects the active site that per-site pages
// (Analytics, Editor…) scope to. Deterministic — seeds two sites straight into the test
// DB under the seeded org (no GitHub/MinIO), so it runs in CI.

const ALPHA = { id: "e2e-switch-alpha", slug: "switch-alpha", name: "Switcher Alpha" };
const BETA = { id: "e2e-switch-beta", slug: "switch-beta", name: "Switcher Beta" };

test.describe("dashboard site switcher", () => {
  const sql = postgres(TEST_DB_URL, { max: 1 });

  test.beforeAll(async () => {
    const [org] = await sql`select id from organization limit 1`;
    expect(org, "expected a seeded organization").toBeTruthy();

    // Stable createdAt so Alpha is the default "first" site (oldest-first ordering).
    for (const [i, s] of [ALPHA, BETA].entries()) {
      await sql`delete from site where id = ${s.id}`;
      await sql`insert into site (id, organization_id, name, slug, repo_owner, repo_name, branch, status, created_at)
                values (${s.id}, ${org.id}, ${s.name}, ${s.slug}, 'acme', 'docs', 'main', 'live',
                        ${new Date(Date.UTC(2026, 0, 1 + i))})`;
    }
  });

  test.afterAll(async () => {
    await sql`delete from site where id in (${ALPHA.id}, ${BETA.id})`;
    await sql.end();
  });

  test("lists the org's sites, switches the active one, and scopes Analytics to it", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    const switcher = page.getByRole("button", { name: "Switch site" });

    // Opening it lists both sites + a New-site action.
    await switcher.click();
    const listbox = page.getByRole("listbox");
    await expect(listbox.getByRole("option", { name: new RegExp(ALPHA.name) })).toBeVisible();
    await expect(listbox.getByRole("option", { name: new RegExp(BETA.name) })).toBeVisible();
    await expect(listbox.getByRole("link", { name: "New site" })).toBeVisible();

    // Selecting Beta updates the active site in place (no manual reload).
    await listbox.getByRole("option", { name: new RegExp(BETA.name) }).click();
    await expect(switcher).toContainText(BETA.name);

    // …and the per-site Analytics page is now scoped to Beta.
    await page.goto("/dashboard/analytics");
    const heading = page.getByRole("heading", { name: "Analytics" });
    await expect(heading).toBeVisible();
    await expect(heading.locator("xpath=following-sibling::*[1]")).toHaveText(BETA.name);

    // Switching back to Alpha re-scopes it (proves the cookie drives the page, not a fluke).
    await switcher.click();
    await page.getByRole("listbox").getByRole("option", { name: new RegExp(ALPHA.name) }).click();
    await expect(heading.locator("xpath=following-sibling::*[1]")).toHaveText(ALPHA.name);
  });

  test("New site action links to the connect form", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Switch site" }).click();
    await page.getByRole("listbox").getByRole("link", { name: "New site" }).click();
    await page.waitForURL("**/dashboard/connect");
    await expect(page.getByRole("heading", { name: "Connect a repository" })).toBeVisible();
  });
});
