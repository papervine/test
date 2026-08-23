import { test, expect } from "@playwright/test";
import postgres from "postgres";
import { TEST_USER, sitePath } from "./constants";
import { TEST_DB_URL } from "./global-setup";

// The hosted → Git "Connect to GitHub" surface (SPEC §10.11), with the one-click path
// ENABLED. Split out from new-site.spec because it needs GITHUB_APP_CLIENT_* set for the
// tab choice to render at all — without them `canCreateRepo` is false, only the
// existing-repo view shows, and a test that "passes" never exercised the choice.
const SITE = { id: "e2e-connect-gh", slug: "e2e-connect-gh", name: "Connect GH E2E" };
const INSTALL_ID = 987654;

const hasClientCreds = Boolean(
  process.env.GITHUB_APP_CLIENT_ID && process.env.GITHUB_APP_CLIENT_SECRET,
);

test.beforeAll(async () => {
  const sql = postgres(TEST_DB_URL, { max: 1 });
  const [org] = await sql`select id from organization where name = ${TEST_USER.org} limit 1`;
  expect(org, "expected the onboarded org").toBeTruthy();
  await sql`delete from site where id = ${SITE.id}`;
  await sql`insert into site (id, organization_id, name, slug, source_kind, repo_owner, repo_name, branch, status)
            values (${SITE.id}, ${org.id}, ${SITE.name}, ${SITE.slug}, 'native', null, null, 'main', 'live')`;
  // An installation row makes the page render its "App installed" state and enables the
  // connect button, without needing a real GitHub install.
  await sql`delete from github_installation where installation_id = ${INSTALL_ID}`;
  await sql`insert into github_installation (id, organization_id, installation_id, account_login)
            values (${SITE.id}, ${org.id}, ${INSTALL_ID}, 'e2e-account')`;
  await sql.end();
});

test.afterAll(async () => {
  const sql = postgres(TEST_DB_URL, { max: 1 });
  await sql`delete from github_installation where installation_id = ${INSTALL_ID}`;
  await sql`delete from site where id = ${SITE.id}`;
  await sql.end();
});

test("the page hydrates — switching to the existing-repo path reveals its selects", async ({
  page,
}) => {
  test.slow();
  // Client credentials decide whether the tab choice exists at all.
  test.skip(!hasClientCreds, "needs GITHUB_APP_CLIENT_ID/SECRET to render the tab choice");

  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

  await page.goto(sitePath(SITE.slug, "settings/git"));
  // First visit to this route in the run cold-compiles it; `test.slow()` raises the TEST
  // budget but not the per-assertion 5s, so this one needs its own headroom.
  await expect(page.getByRole("heading", { name: "Connect to GitHub" })).toBeVisible({
    timeout: 60_000,
  });

  // Default is the one-click path.
  const createTab = page.getByRole("button", { name: /Create a repo for me/ });
  const existingTab = page.getByRole("button", { name: /Use an existing repo/ });
  await expect(createTab).toBeVisible();
  await expect(existingTab).toBeVisible();
  await expect(page.getByLabel("Repository name")).toBeVisible();

  // THE assertion: clicking actually switches. A dead click here means the page didn't
  // hydrate, which looks exactly like a product bug ("the button does nothing").
  await existingTab.click();
  await expect(page.getByRole("combobox", { name: "Repository" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Branch" })).toBeVisible();
  // The empty case is the simple one; a non-empty repo is now a question we ask rather than
  // a rule we enforce, so the copy sets that expectation instead of stating a constraint.
  await expect(page.getByText(/which version is the one to keep/i)).toBeVisible();
  // The one-click field is gone, so this is a real swap rather than both rendering.
  await expect(page.getByLabel("Repository name")).toBeHidden();

  // And back, so the choice isn't one-way.
  await createTab.click();
  await expect(page.getByLabel("Repository name")).toBeVisible();

  expect(errors, `unexpected page errors:\n${errors.join("\n")}`).toEqual([]);
});

test("the connect button stays disabled until a repository is chosen", async ({ page }) => {
  test.skip(!hasClientCreds, "needs GITHUB_APP_CLIENT_ID/SECRET to render the tab choice");
  await page.goto(sitePath(SITE.slug, "settings/git"));
  await page.getByRole("button", { name: /Use an existing repo/ }).click();
  // Only "no repo picked" holds it closed now. A NON-EMPTY repo deliberately does not —
  // pressing Connect there opens the which-version-wins prompt (the server answers
  // needsResolution), rather than the button silently refusing to work.
  await expect(page.getByRole("button", { name: "Connect to GitHub" })).toBeDisabled();
});
