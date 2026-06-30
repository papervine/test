import { test, expect } from "@playwright/test";
import postgres from "postgres";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { TEST_DB_URL } from "./global-setup";
import { ORG_SLUG, sitePath } from "./constants";

// The web editor (SPEC §9.2/§10): the 3-panel editor on the shared authoring backend.
// Deterministic-ish (no GitHub writes): seed a synced site + content into Postgres + MinIO,
// open the editor, assert the shell renders draft-aware nav/content, toggle Source mode,
// type, and confirm the edit persists to the Postgres draft buffer.
//
// @external: needs MinIO (object storage), which CI's e2e job doesn't run. The git-write /
// publish path is unit-tested in tests/unit/authoring-publish.test.ts.

const SITE_ID = "e2e-editor-site";
const SLUG = "editor-e2e";

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT ?? "http://127.0.0.1:9000",
  region: "auto",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "minioadmin",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "minioadmin",
  },
  forcePathStyle: true,
});

const put = (key: string, body: string, contentType = "text/plain") =>
  s3.send(new PutObjectCommand({ Bucket: "papervine-content", Key: key, Body: body, ContentType: contentType }));

test.describe("web editor @external", () => {
  const sql = postgres(TEST_DB_URL, { max: 1 });

  test.beforeAll(async () => {
    const [org] = await sql`select id from organization limit 1`;
    expect(org, "expected a seeded organization").toBeTruthy();

    await sql`delete from site where id = ${SITE_ID}`;
    await sql`insert into site (id, organization_id, name, slug, repo_owner, repo_name, branch, status, last_synced_commit_sha)
              values (${SITE_ID}, ${org.id}, 'Editor E2E', ${SLUG}, 'acme', 'docs', 'main', 'live', 'e2eheadsha')`;

    const prefix = `sites/${SITE_ID}/`;
    await put(
      `${prefix}docs.json`,
      JSON.stringify({ name: "Editor E2E", navigation: { pages: ["index", "second"] } }),
      "application/json",
    );
    await put(`${prefix}index.mdx`, "---\ntitle: Home\n---\n\nOriginal body text.\n");
    await put(`${prefix}second.mdx`, "---\ntitle: Second Page\n---\n\nThe second page body.\n");
  });

  test.afterAll(async () => {
    await sql`delete from site where id = ${SITE_ID}`;
    await sql.end();
  });

  test("renders the 3-panel editor and persists a source edit to the draft buffer", async ({ page }) => {
    await page.goto(sitePath(SLUG, "editor"));

    // The editor shell: nav, branch switcher, and the on-demand agent toggle. The editor opens on
    // the site's configured deploy branch ("main") by default — not a freshly-minted edit-* branch.
    // The agent composer is hidden until summoned (see the dedicated test below).
    await expect(page.getByRole("button", { name: /Ask agent/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "main", exact: true })).toBeVisible();

    // Switch to Source mode and type into the raw MDX.
    await page.getByRole("button", { name: "Source mode" }).click();
    const textarea = page.locator("textarea").last();
    await expect(textarea).toContainText("Original body text", { timeout: 10_000 });
    await textarea.click();
    await textarea.press("End");
    await textarea.pressSequentially("\n\nAdded by the e2e editor test.");

    // The debounced autosave (700ms) should land a draft row for index.mdx.
    await expect
      .poll(
        async () => {
          const rows = await sql`
            select content from draft_file d
            join editor_session s on s.id = d.session_id
            where s.site_id = ${SITE_ID} and d.path = 'index.mdx'`;
          return rows[0]?.content ?? "";
        },
        { timeout: 10_000 },
      )
      .toContain("Added by the e2e editor test.");
  });

  // The editor pane is `key`ed by page, so it remounts on every nav click. The Source/Preview
  // mode must survive that remount: switch pages in Preview and you stay in Preview (rendered),
  // in Source and you stay in Source. (Mode lives in EditorShell, not pane-local state.)
  test("keeps the Source/Preview mode when switching pages in the nav", async ({ page }) => {
    await page.goto(sitePath(SLUG, "editor"));
    await expect(page.getByRole("button", { name: "main", exact: true })).toBeVisible();

    // Source mode (the default): clicking another page shows that page's raw MDX, still in Source.
    await page.getByRole("button", { name: "Source mode" }).click();
    await page.getByRole("button", { name: "Second Page" }).click();
    await expect(page.locator("textarea").last()).toContainText("The second page body", {
      timeout: 10_000,
    });
    // The "Refresh preview" control is mounted only in Preview mode — absent confirms Source.
    await expect(page.getByRole("button", { name: "Refresh preview" })).toHaveCount(0);

    // Now enter Preview, switch back to the first page, and confirm we stay in Preview (render).
    await page.getByRole("button", { name: "Preview mode" }).click();
    await expect(page.getByRole("button", { name: "Refresh preview" })).toBeVisible();
    await page.getByRole("button", { name: "Home", exact: true }).click();
    await expect(page.getByRole("button", { name: "Refresh preview" })).toBeVisible();
    await expect(page.locator('iframe[title="Live preview"]')).toBeVisible();
  });

  // A keystroke still inside the 700ms autosave debounce must not be lost when you switch pages —
  // EditorShell flushes the pane before the remount. (Without the flush the debounce timer is
  // cleared on unmount and the edit vanishes.) We switch immediately, faster than the debounce.
  test("flushes a pending edit when switching pages before autosave fires", async ({ page }) => {
    await page.goto(sitePath(SLUG, "editor"));
    await page.getByRole("button", { name: "Source mode" }).click();

    const textarea = page.locator("textarea").last();
    await expect(textarea).toContainText("Original body text", { timeout: 10_000 });
    await textarea.click();
    await textarea.press("End");
    await textarea.pressSequentially("\n\nFlushed on switch.");

    // No debounce wait: jump to the second page and straight back. The edit must have been
    // flushed to the draft buffer on the way out, so it's still here on return.
    await page.getByRole("button", { name: "Second Page" }).click();
    await page.getByRole("button", { name: "Home", exact: true }).click();
    await expect(page.locator("textarea").last()).toContainText("Flushed on switch.", {
      timeout: 10_000,
    });
  });

  // The editing-agent column is hidden by default and summoned on demand (Ask agent / ⌘I), so the
  // editor opens with room to write. Toggling preserves the panel (CSS visibility, not unmount).
  test("keeps the editing-agent column hidden until summoned", async ({ page }) => {
    await page.goto(sitePath(SLUG, "editor"));
    const composer = page.getByPlaceholder('Try "expand more about…"');

    // Hidden on load.
    await expect(page.getByRole("button", { name: /Ask agent/ })).toBeVisible();
    await expect(composer).toBeHidden();

    // Summon it, then close it from the panel's ✕.
    await page.getByRole("button", { name: /Ask agent/ }).click();
    await expect(composer).toBeVisible();
    await page.getByRole("button", { name: "Close agent" }).click();
    await expect(composer).toBeHidden();
  });
});
