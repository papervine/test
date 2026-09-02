import { test, expect } from "@playwright/test";
import postgres from "postgres";
import { TEST_USER, ORG_SLUG, sitePath } from "./constants";
import { TEST_DB_URL } from "./global-setup";

// The add-site start-method chooser and the Papervine-hosted site kind it creates
// (SPEC §10.11). Split by real dependency: the chooser's behavior and the repo-shaped
// degradations need nothing but Postgres, so they run in CI; only the create journey needs
// object storage (MinIO), which CI's e2e job doesn't run — that one is @external, the same
// reason editor.spec.ts is.

test.describe("the start-method chooser", () => {
  test("offers both ways in and expands only the selected one", async ({ page }) => {
    // First visit to this route in the run — cold compile under `next dev`.
    test.slow();
    await page.goto(`/${ORG_SLUG}/connect`);

    const scratch = page.getByRole("radio", { name: /Start from scratch/ });
    const git = page.getByRole("radio", { name: /Connect a GitHub repo/ });
    await expect(scratch).toBeVisible();
    await expect(git).toBeVisible();

    // "Start from scratch" leads: it's the fastest path to a live site, and the seeded
    // owner can open Studio.
    await expect(scratch).toBeChecked();
    await expect(page.getByLabel("Site name")).toBeVisible();
    await expect(page.getByLabel("GitHub repository")).toBeHidden();
    await expect(page.getByRole("button", { name: "Create site" })).toBeVisible();

    // Selecting the other method swaps the inline fields AND the single primary button,
    // which lives outside both forms and is wired to the selected one by `form=`.
    await git.click();
    await expect(git).toBeChecked();
    await expect(page.getByLabel("GitHub repository")).toBeVisible();
    await expect(page.getByLabel("Branch")).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect repository" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create site" })).toBeHidden();
  });

  // A new interactive React surface with conditionally-mounted forms and two useActionState
  // hooks is exactly the shape that produced this repo's flushSync / update-depth bugs —
  // invisible in the DOM and in screenshots, visible only in the console (CLAUDE.md DoD #4).
  test("switching methods produces no React console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
    });

    await page.goto(`/${ORG_SLUG}/connect`);
    await page.getByRole("radio", { name: /Connect a GitHub repo/ }).click();
    await expect(page.getByLabel("GitHub repository")).toBeVisible();
    await page.getByRole("radio", { name: /Start from scratch/ }).click();
    await expect(page.getByLabel("Site name")).toBeVisible();
    // Type into the controlled name field — its live subdomain preview re-renders per keystroke.
    await page.getByLabel("Site name").fill("Console Check");
    await page.waitForTimeout(300);

    const reactErrors = errors.filter(
      (e) =>
        e.startsWith("pageerror:") ||
        /flushSync|Maximum update depth|Cannot update a component|not wrapped in act|hydrat/i.test(e),
    );
    expect(reactErrors, `unexpected React errors:\n${reactErrors.join("\n")}`).toEqual([]);
  });
});

// A Papervine-hosted site seeded straight into Postgres — no MinIO, no GitHub, so this
// pins every repo-shaped degradation in CI. Status 'live' mirrors what createBlankSite
// leaves behind; its storage content is irrelevant to these assertions.
test.describe("a Papervine-hosted site", () => {
  const SITE = { id: "e2e-native-site", slug: "e2e-native", name: "Hosted E2E" };

  test.beforeAll(async () => {
    const sql = postgres(TEST_DB_URL, { max: 1 });
    const [org] = await sql`select id from organization where name = ${TEST_USER.org} limit 1`;
    expect(org, "expected the onboarded org").toBeTruthy();
    await sql`delete from site where id = ${SITE.id}`;
    await sql`insert into site (id, organization_id, name, slug, source_kind, repo_owner, repo_name, branch, status)
              values (${SITE.id}, ${org.id}, ${SITE.name}, ${SITE.slug}, 'native', null, null, 'main', 'live')`;
    await sql.end();
  });

  test.afterAll(async () => {
    const sql = postgres(TEST_DB_URL, { max: 1 });
    await sql`delete from site where id = ${SITE.id}`;
    await sql.end();
  });

  test("the overview names Papervine as the source and offers no Re-sync", async ({ page }) => {
    test.slow();
    await page.goto(sitePath(SITE.slug));
    await expect(page.getByRole("heading", { name: SITE.name })).toBeVisible();

    // Re-sync used to render regardless and silently no-op — there's no repo to pull from.
    await expect(page.getByRole("button", { name: /Re-sync/i })).toBeHidden();
    await expect(page.getByText("Repository", { exact: true })).toBeHidden();
    // Says where content comes from, rather than leaving a gap that reads as a broken repo
    // row. Locate the row by its <dt> and assert on that <dd>: the visible spacing comes from
    // flex `gap`, so the concatenated text has no spaces to match on.
    const sourceRow = page.locator('dt:text-is("Source") + dd');
    await expect(sourceRow).toContainText("Papervine");
    await expect(sourceRow.getByRole("link", { name: "Studio" })).toBeVisible();
  });

  // Git settings stays reachable for a hosted site — hiding it is what made "I see no way
  // to connect it to GitHub" true. The page's CONTENT is what differs.
  test("Settings still offers Git settings, as the way to connect", async ({ page }) => {
    await page.goto(sitePath(SITE.slug, "settings"));
    await expect(page.getByRole("link", { name: "Git settings" }).first()).toBeVisible();
  });

  test("Git settings shows the connect flow instead of a repo form", async ({ page }) => {
    await page.goto(sitePath(SITE.slug, "settings/git"));
    await expect(page.getByRole("heading", { name: "Connect to GitHub" })).toBeVisible();
    await expect(page.getByText(/Nothing is deleted/)).toBeVisible();
    // The re-point form belongs to Git-backed sites only.
    await expect(page.getByRole("button", { name: /Save|Update/ })).toBeHidden();
  });

  // Regression: the existing-repo path was labelled "I'll make it myself", which reads as
  // "create" — so someone looking to point the site at a repo they already had saw no option
  // for it. Whichever way in is offered, a repository field must be reachable.
  test("offers a way to point the site at a repository you already have", async ({ page }) => {
    await page.goto(sitePath(SITE.slug, "settings/git"));
    const existing = page.getByRole("button", { name: /Use an existing repo/ });
    if (await existing.isVisible()) await existing.click();
    // A select over the App's reachable repos, not free text — you shouldn't have to know
    // how to spell owner/name.
    await expect(page.getByRole("combobox", { name: "Repository" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Branch" })).toBeVisible();
    // The empty-repo rule has to be stated before they try, not only in the error after.
    // A non-empty repo is a question we ask, not a rule we enforce — so the copy sets that
    // expectation up front rather than stating a constraint.
    await expect(page.getByText(/which version is the one to keep/i)).toBeVisible();
  });

  // Regression: the App-install CTA used to live inside the manual tab only, so with
  // one-click configured the default view offered NO way to install the App — the same
  // "it's behind a door you'd never open" mistake as hiding Git settings itself. Both
  // paths need the App (the push uses an installation token), so it sits above the choice.
  test("offers GitHub App installation regardless of which path is selected", async ({ page }) => {
    await page.goto(sitePath(SITE.slug, "settings/git"));
    await expect(page.getByText("GitHub access", { exact: true })).toBeVisible();
    const installCta = page.getByRole("link", { name: /Install the GitHub App/ });
    const oneClick = page.getByRole("button", { name: /Create one for me/ });
    // Only meaningful where the deployment has an App configured at all.
    if (await installCta.isVisible()) {
      if (await oneClick.isVisible()) {
        await oneClick.click();
        await expect(installCta).toBeVisible();
        await page.getByRole("button", { name: /Use an existing repo/ }).click();
        await expect(installCta).toBeVisible();
      }
    }
  });

  test("Exports points at Studio rather than telling you to connect a repo", async ({ page }) => {
    // The only test in the suite that visits settings/exports, so it cold-compiles that route
    // itself. Failed on its shard at the 30s default with `net::ERR_ABORTED; maybe frame was
    // detached?` — the test clock expiring mid-navigation, which reads as a crashed page and
    // is not one. Budget, not code; same shape as the rest of this file's slow() calls.
    test.slow();
    await page.goto(sitePath(SITE.slug, "settings/exports"));
    // status is 'live', so the export is available; the copy is what differs per source.
    await expect(page.getByText(/Connect and sync a repo first/)).toBeHidden();
  });
});

// The real journey writes the starter content to object storage, so it needs MinIO — which
// CI's e2e job doesn't run. Tagged in the TITLE so `--grep-invert @external` skips it.
test.describe("starting from scratch @external", () => {
  const SLUG = "scratch-e2e";

  test.afterAll(async () => {
    const sql = postgres(TEST_DB_URL, { max: 1 });
    await sql`delete from site where slug = ${SLUG}`;
    await sql.end();
  });

  test("creates a live hosted site and lands in Studio", async ({ page }) => {
    test.slow();
    await page.goto(`/${ORG_SLUG}/connect`);
    await page.getByRole("radio", { name: /Start from scratch/ }).click();
    await page.getByLabel("Site name").fill("Scratch E2E");
    await page.getByRole("button", { name: "Create site" }).click();

    // The action seeds storage inline, then returns Studio's bare URL; the client
    // hard-navigates (a soft nav would skip the app-host Host rewrite).
    await page.waitForURL(`**/${ORG_SLUG}/${SLUG}/editor`, { timeout: 60_000 });
    // The seeded pages are readable through the editor, which proves the starter content
    // reached storage AND that requestContentSource no longer gates on having a repo.
    await expect(page.getByText("Quickstart").first()).toBeVisible({ timeout: 30_000 });
  });
});
