import { test, expect } from "@playwright/test";
import postgres from "postgres";
import { TEST_DB_URL } from "./global-setup";
import { sitePath } from "./constants";

// Automate › Automations (SPEC §10.2): the Configure catalog + config dialog + run
// history, backed by the automation/automation_run tables. Deterministic: everything
// is Postgres — no MinIO, no GitHub, no Trigger.dev (the page must degrade to the
// "Executor not configured" banner without TRIGGER_SECRET_KEY; that degradation is
// itself under test).

const SITE_ID = "e2e-automations-site";
const SLUG = "automations-e2e";

test.describe("automations", () => {
  const sql = postgres(TEST_DB_URL, { max: 1 });

  test.beforeAll(async () => {
    const [org] = await sql`select id from organization limit 1`;
    expect(org, "expected a seeded organization").toBeTruthy();
    await sql`delete from site where id = ${SITE_ID}`;
    await sql`insert into site (id, organization_id, name, slug, repo_owner, repo_name, branch, status)
              values (${SITE_ID}, ${org.id}, 'Automations E2E', ${SLUG}, 'acme', 'docs', 'main', 'live')`;
  });

  test.afterAll(async () => {
    await sql`delete from site where id = ${SITE_ID}`;
    await sql.end();
  });

  test("renders the catalog, persists a toggle-on with defaults, and opens the config dialog", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
    });

    await page.goto(sitePath(SLUG, "automate/automations"));

    // No TRIGGER_SECRET_KEY in e2e → the page must say so instead of breaking.
    await expect(page.getByText("Executor not configured.")).toBeVisible();

    // The full predefined catalog renders.
    await expect(page.getByRole("heading", { name: "Update from code changes" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Fix broken links" })).toBeVisible();

    // Toggle Fix broken links on from the card — creates the row with catalog defaults.
    // Scope to the card container (rounded-xl), not a bare div filter: every ancestor
    // div "has" the heading, and .first() would resolve to the first card on the page.
    const card = page
      .locator("div.rounded-xl")
      .filter({ has: page.getByRole("heading", { name: "Fix broken links", exact: true }) });
    const cardSwitch = card.locator("button[role=switch]");
    await cardSwitch.click();
    await expect(cardSwitch).toHaveAttribute("data-state", "checked");
    await expect
      .poll(async () => {
        const rows =
          await sql`select enabled, trigger_type, apply_mode from automation where site_id = ${SITE_ID} and catalog_key = 'fix-broken-links'`;
        return rows[0] ? `${rows[0].enabled}:${rows[0].trigger_type}:${rows[0].apply_mode}` : "missing";
      })
      .toBe("true:content_update:auto");

    // The settings dialog opens with the uniform config schema fields.
    await card.locator("button[title=Settings]").click();
    await expect(page.getByRole("heading", { name: "Fix broken links settings" })).toBeVisible();
    await expect(page.getByText("When should the automation run?")).toBeVisible();
    await expect(page.getByText("How should updates be applied?")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();

    // Console-clean gate (the editor.spec pattern). The known pre-existing AppRail
    // "Switch site" radix-id hydration warning is excluded — it fires on every
    // dashboard page and predates this surface (tracked in SPEC §10.2 follow-ups);
    // everything else, including render loops and pageerrors, fails the build.
    const reactErrors = errors.filter(
      (e) =>
        (e.startsWith("pageerror:") ||
          /flushSync|Maximum update depth|Cannot update a component|not wrapped in act/i.test(e)) &&
        !/hydrated but some attributes/i.test(e),
    );
    expect(reactErrors, `unexpected React errors:\n${reactErrors.join("\n")}`).toEqual([]);
  });

  test("run history lists runs with status, no-changes chip, and error detail", async ({
    page,
  }) => {
    const [auto] =
      await sql`select id from automation where site_id = ${SITE_ID} and catalog_key = 'fix-broken-links'`;
    expect(auto, "expected the automation created by the toggle test").toBeTruthy();
    await sql`delete from automation_run where site_id = ${SITE_ID}`;
    await sql`insert into automation_run (id, automation_id, site_id, trigger_type, trigger_ref, status, error, credits_used, queued_at, finished_at)
              values ('e2e-run-1', ${auto.id}, ${SITE_ID}, 'manual', 'e2e', 'failed', 'agent exploded (e2e fixture)', 7, now(), now())`;
    // A succeeded run with no resultRef renders as the distinct "no changes" outcome.
    await sql`insert into automation_run (id, automation_id, site_id, trigger_type, status, summary, credits_used, queued_at, finished_at)
              values ('e2e-run-2', ${auto.id}, ${SITE_ID}, 'cron', 'succeeded', 'Everything was already clean.', 5, now() - interval '1 minute', now())`;

    await page.goto(sitePath(SLUG, "automate/automations?tab=runs"));
    await expect(page.getByText("agent exploded (e2e fixture)")).toBeVisible();
    await expect(page.getByText("failed", { exact: true })).toBeVisible();
    await expect(page.getByText("no changes", { exact: true })).toBeVisible();
  });

  test("clicking a run opens the detail view with prompt, files, and summary", async ({
    page,
  }) => {
    const [auto] =
      await sql`select id from automation where site_id = ${SITE_ID} and catalog_key = 'fix-broken-links'`;
    await sql`delete from automation_run where site_id = ${SITE_ID}`;
    await sql`insert into automation_run (id, automation_id, site_id, trigger_type, status, result_ref, summary, prompt, changed_files, credits_used, queued_at, started_at, finished_at)
              values ('e2e-run-3', ${auto.id}, ${SITE_ID}, 'manual', 'succeeded', 'abc1234def', 'Fixed one broken link in the intro.', 'Find internal links that are broken and fix them.', ${sql.json(["index.mdx", "quickstart.mdx"])}, 12, now(), now(), now())`;

    await page.goto(sitePath(SLUG, "automate/automations?tab=runs"));
    await page.getByRole("link", { name: "Fix broken links" }).click();
    await expect(page).toHaveURL(/\/runs\/e2e-run-3/);
    await expect(page.getByRole("heading", { name: "Fix broken links" })).toBeVisible();
    await expect(page.getByText("Fixed one broken link in the intro.")).toBeVisible();
    await expect(page.getByText("Changed files (2)")).toBeVisible();
    await expect(page.getByText("index.mdx", { exact: true })).toBeVisible();
    // The prompt is behind a disclosure.
    await page.getByText("The exact instructions this run received").click();
    await expect(page.getByText("Find internal links that are broken")).toBeVisible();
  });

  test("a review_needed run offers Accept/View changes/Reject; Reject discards the draft", async ({
    page,
  }) => {
    const [auto] =
      await sql`select id from automation where site_id = ${SITE_ID} and catalog_key = 'fix-broken-links'`;
    const SESSION = "e2e-review-session";
    const BRANCH = "papervine/review-e2e";
    await sql`delete from automation_run where site_id = ${SITE_ID}`;
    await sql`delete from editor_session where id = ${SESSION}`;
    // A run in review leaves an OPEN edit session + its buffered draft (SPEC §10.2 in-app review).
    await sql`insert into editor_session (id, site_id, branch, base_branch, status)
              values (${SESSION}, ${SITE_ID}, ${BRANCH}, 'main', 'open')`;
    await sql`insert into draft_file (id, session_id, path, content)
              values ('e2e-review-draft', ${SESSION}, 'index.mdx', '# Fixed' || chr(10))`;
    await sql`insert into automation_run (id, automation_id, site_id, trigger_type, status, review_branch, summary, changed_files, credits_used, queued_at, finished_at)
              values ('e2e-review-1', ${auto.id}, ${SITE_ID}, 'manual', 'review_needed', ${BRANCH}, 'Fixed a typo, pending review.', ${sql.json(["index.mdx"])}, 9, now(), now())`;

    await page.goto(sitePath(SLUG, "automate/automations/runs/e2e-review-1"));
    await expect(page.getByText("review needed", { exact: true })).toBeVisible();
    await expect(page.getByText("waiting for your review")).toBeVisible();
    await expect(page.getByRole("link", { name: /View changes/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Accept/ })).toBeVisible();

    // Reject discards the session (no git needed) and marks the run rejected.
    await page.getByRole("button", { name: /Reject/ }).click();
    await expect
      .poll(async () => {
        const [r] =
          await sql`select status, review_branch from automation_run where id = 'e2e-review-1'`;
        return r ? `${r.status}:${r.review_branch ?? "null"}` : "missing";
      })
      .toBe("rejected:null");
    const [s] = await sql`select status from editor_session where id = ${SESSION}`;
    expect(s.status).toBe("discarded");
  });
});
