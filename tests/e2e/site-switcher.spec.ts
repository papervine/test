import { test, expect } from "@playwright/test";
import postgres from "postgres";
import { TEST_DB_URL } from "./global-setup";
import { ORG_SLUG, TEST_USER, sitePath } from "./constants";

// The top-left site switcher (SPEC §10): the control plane is URL-scoped, so switching a
// site *navigates* to /:org/:site (preserving the sub-page) — shareable, multi-tab, no
// cookie. Deterministic — seeds two sites straight into the test DB under the seeded org
// (no GitHub/MinIO), so it runs in CI.

const ALPHA = { id: "e2e-switch-alpha", slug: "switch-alpha", name: "Switcher Alpha" };
const BETA = { id: "e2e-switch-beta", slug: "switch-beta", name: "Switcher Beta" };

test.describe("dashboard site switcher", () => {
  const sql = postgres(TEST_DB_URL, { max: 1 });

  test.beforeAll(async () => {
    // By name, like the other specs — `limit 1` over all orgs is order-dependent if
    // another spec ever seeds one.
    const [org] =
      await sql`select id from organization where name = ${TEST_USER.org} limit 1`;
    expect(org, `expected the seeded org "${TEST_USER.org}"`).toBeTruthy();

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

  test("lists the org's sites and switching one changes the URL, preserving the sub-page", async ({
    page,
  }) => {
    await page.goto(sitePath(ALPHA.slug));
    const switcher = page.getByRole("button", { name: "Switch site" });

    // Opening it lists both sites + a New-site action. The switcher is a shadcn
    // DropdownMenu (role menu/menuitem; the content portals to <body>), not a listbox.
    await switcher.click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem", { name: new RegExp(ALPHA.name) })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: new RegExp(BETA.name) })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "New site" })).toBeVisible();

    // Selecting Beta navigates to its bare URL — the switcher now shows Beta.
    await menu.getByRole("menuitem", { name: new RegExp(BETA.name) }).click();
    await page.waitForURL(`**/${ORG_SLUG}/${BETA.slug}`);
    await expect(switcher).toContainText(BETA.name);

    // From a sub-page, switching preserves it: Alpha's Analytics → Beta's Analytics, and
    // the page is scoped to Beta (the name label by the heading).
    await page.goto(sitePath(ALPHA.slug, "analytics"));
    await switcher.click();
    await page.getByRole("menu").getByRole("menuitem", { name: new RegExp(BETA.name) }).click();
    await page.waitForURL(`**/${ORG_SLUG}/${BETA.slug}/analytics`);
    const heading = page.getByRole("heading", { name: "Insights" });
    await expect(heading.locator("xpath=following-sibling::*[1]")).toHaveText(BETA.name);
  });

  test("New site action links to the connect form", async ({ page }) => {
    await page.goto(sitePath(ALPHA.slug));
    await page.getByRole("button", { name: "Switch site" }).click();
    await page.getByRole("menu").getByRole("menuitem", { name: "New site" }).click();
    await page.waitForURL(`**/${ORG_SLUG}/connect`);
    await expect(page.getByRole("heading", { name: "Connect a repository" })).toBeVisible();
  });
});
