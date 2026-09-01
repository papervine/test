import { test, expect } from "@playwright/test";
import postgres from "postgres";
import { TEST_USER, ORG_SLUG, sitePath } from "./constants";
import { TEST_DB_URL } from "./global-setup";

// Logged in via the saved session (storageState). The control plane is URL-scoped
// (SPEC §10), so we seed a site and open its bare /:org/:site overview directly.
// SITE is public; AUTH_SITE gates its docs (JWT) so we can assert both states of the
// overview's Authentication row.
const SITE = { id: "e2e-dash-site", slug: "e2e-dash", name: "Dashboard E2E" };
const AUTH_SITE = { id: "e2e-dash-auth", slug: "e2e-dash-auth", name: "Gated E2E" };

test.beforeAll(async () => {
  const sql = postgres(TEST_DB_URL, { max: 1 });
  const [org] = await sql`select id from organization where name = ${TEST_USER.org} limit 1`;
  expect(org, "expected the onboarded org").toBeTruthy();
  await sql`delete from site where id in (${SITE.id}, ${AUTH_SITE.id})`;
  await sql`insert into site (id, organization_id, name, slug, repo_owner, repo_name, branch, status)
            values (${SITE.id}, ${org.id}, ${SITE.name}, ${SITE.slug}, 'acme', 'docs', 'main', 'live')`;
  await sql`insert into site (id, organization_id, name, slug, repo_owner, repo_name, branch, status,
                             auth_enabled, auth_method)
            values (${AUTH_SITE.id}, ${org.id}, ${AUTH_SITE.name}, ${AUTH_SITE.slug}, 'acme', 'docs', 'main', 'live',
                    true, 'jwt')`;
  await sql.end();
});

test.afterAll(async () => {
  const sql = postgres(TEST_DB_URL, { max: 1 });
  await sql`delete from site where id in (${SITE.id}, ${AUTH_SITE.id})`;
  await sql.end();
});

test("the site overview greets the user and renders the rail", async ({ page }) => {
  // First visit to the overview route in the run: under `next dev` its cold compile
  // (activity feed + preview + rail) can exceed the 30s default. 3× headroom; the
  // later tests hit the same page warm.
  test.slow();
  await page.goto(sitePath(SITE.slug));
  // URL-scoped: we stay on the bare /:org/:site path.
  await expect(page).toHaveURL(new RegExp(`/${ORG_SLUG}/${SITE.slug}$`));
  await expect(
    page.getByRole("heading", {
      name: new RegExp(`Good (morning|afternoon|evening), ${TEST_USER.name.split(" ")[0]}`),
    }),
  ).toBeVisible();
  // The control-plane rail + the active site's name. The rail item is labelled "Insights"
  // (AppRail.tsx) even though its route is /analytics — assert the label users see.
  await expect(page.getByRole("link", { name: "Insights" })).toBeVisible();
  await expect(page.getByRole("heading", { name: SITE.name })).toBeVisible();
});

test("a public site shows the open status + a link to edit auth", async ({ page }) => {
  await page.goto(sitePath(SITE.slug));
  await expect(page.getByText("Public — anyone can read")).toBeVisible();
  // exact: role-name matching is substring by default, and the page also has
  // "Editor" / "Open editor" links (the editor workspace) that "Edit" would match.
  const edit = page.getByRole("link", { name: "Edit", exact: true });
  await expect(edit).toHaveAttribute(
    "href",
    sitePath(SITE.slug, "settings/authentication"),
  );
});

test("a gated site shows the required status + method + edit link", async ({ page }) => {
  await page.goto(sitePath(AUTH_SITE.slug));
  await expect(page.getByText("Required")).toBeVisible();
  await expect(page.getByText("JWT")).toBeVisible();
  const edit = page.getByRole("link", { name: "Edit", exact: true });
  await expect(edit).toHaveAttribute(
    "href",
    sitePath(AUTH_SITE.slug, "settings/authentication"),
  );
});

// The MCP page's two fields (SPEC §8.5) exist to be pasted into somebody's client config, so both
// carry a copy button. Worth a browser rather than a unit test for two reasons: the buttons are a
// client component mounted by a server page (a bad boundary shows up only here), and what lands on
// the clipboard has to be the string that was on screen — the config block is rendered from and
// copied from one value precisely so those can't drift.
test("the MCP page copies its server URL and client config to the clipboard", async ({
  page,
  context,
}) => {
  // Reading the clipboard back needs an explicit grant; writing doesn't.
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(sitePath(SITE.slug, "mcp"));

  const url = await page.locator("pre code").first().innerText();
  expect(url, "the server URL block should render an /mcp endpoint").toContain("/mcp");
  await page.getByRole("button", { name: "Copy server URL" }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 5_000 })
    .toBe(url);

  const config = await page.locator("pre code").nth(1).innerText();
  expect(config, "the client config should name the site").toContain(SITE.slug);
  await page.getByRole("button", { name: "Copy client config" }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 5_000 })
    .toBe(config);
});
