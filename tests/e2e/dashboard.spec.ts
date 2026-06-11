import { test, expect } from "@playwright/test";
import postgres from "postgres";
import { TEST_USER, ORG_SLUG, sitePath } from "./constants";
import { TEST_DB_URL } from "./global-setup";

// Logged in via the saved session (storageState). The control plane is URL-scoped
// (SPEC §10), so we seed a site and open its bare /:org/:site overview directly.
const SITE = { id: "e2e-dash-site", slug: "e2e-dash", name: "Dashboard E2E" };

test.beforeAll(async () => {
  const sql = postgres(TEST_DB_URL, { max: 1 });
  const [org] = await sql`select id from organization where name = ${TEST_USER.org} limit 1`;
  expect(org, "expected the onboarded org").toBeTruthy();
  await sql`delete from site where id = ${SITE.id}`;
  await sql`insert into site (id, organization_id, name, slug, repo_owner, repo_name, branch, status)
            values (${SITE.id}, ${org.id}, ${SITE.name}, ${SITE.slug}, 'acme', 'docs', 'main', 'live')`;
  await sql.end();
});

test.afterAll(async () => {
  const sql = postgres(TEST_DB_URL, { max: 1 });
  await sql`delete from site where id = ${SITE.id}`;
  await sql.end();
});

test("the site overview greets the user and renders the rail", async ({ page }) => {
  await page.goto(sitePath(SITE.slug));
  // URL-scoped: we stay on the bare /:org/:site path.
  await expect(page).toHaveURL(new RegExp(`/${ORG_SLUG}/${SITE.slug}$`));
  await expect(
    page.getByRole("heading", {
      name: new RegExp(`Good (morning|afternoon|evening), ${TEST_USER.name.split(" ")[0]}`),
    }),
  ).toBeVisible();
  // The control-plane rail + the active site's name.
  await expect(page.getByRole("link", { name: "Analytics" })).toBeVisible();
  await expect(page.getByRole("heading", { name: SITE.name })).toBeVisible();
});
