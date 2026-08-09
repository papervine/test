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

    // Switch to Source mode and type into the raw MDX. Source is CodeMirror bound to the shared
    // Y.Text (SPEC §9.2) — a contenteditable `.cm-content`, not a textarea.
    await page.getByRole("button", { name: "Source mode" }).click();
    const cm = page.locator(".cm-content");
    await expect(cm).toContainText("Original body text", { timeout: 10_000 });
    await cm.click(); // focus + place the caret in the document
    await page.keyboard.type(" Added by the e2e editor test.");

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

  // The editor pane is `key`ed by page, so it remounts on every nav click. The Visual/Source mode
  // must survive that remount: switch pages in Source and you stay in Source (raw MDX), in Visual
  // and you stay in Visual (WYSIWYG). Mode lives in EditorShell, not pane-local state (SPEC §9.2).
  test("keeps the Visual/Source mode when switching pages in the nav", async ({ page }) => {
    await page.goto(sitePath(SLUG, "editor"));
    await expect(page.getByRole("button", { name: "main", exact: true })).toBeVisible();

    // Source mode: clicking another page shows that page's raw MDX in CodeMirror, still in Source.
    await page.getByRole("button", { name: "Source mode" }).click();
    await page.getByRole("button", { name: "Second Page" }).click();
    await expect(page.locator(".cm-content")).toContainText("The second page body", {
      timeout: 10_000,
    });
    // The WYSIWYG surface is absent in Source mode.
    await expect(page.locator(".pv-visual .ProseMirror")).toHaveCount(0);

    // Now enter Visual, switch back to the first page, and confirm we stay in Visual (WYSIWYG).
    await page.getByRole("button", { name: "Visual mode" }).click();
    await expect(page.locator(".pv-visual .ProseMirror")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Home", exact: true }).click();
    await expect(page.locator(".pv-visual .ProseMirror")).toBeVisible();
    await expect(page.locator(".cm-content")).toHaveCount(0);
  });

  // A keystroke still inside the 700ms autosave debounce must not be lost when you switch pages —
  // EditorShell flushes the pane before the remount. (Without the flush the debounce timer is
  // cleared on unmount and the edit vanishes.) We switch immediately, faster than the debounce.
  test("flushes a pending edit when switching pages before autosave fires", async ({ page }) => {
    await page.goto(sitePath(SLUG, "editor"));
    await page.getByRole("button", { name: "Source mode" }).click();

    const cm = page.locator(".cm-content");
    await expect(cm).toContainText("Original body text", { timeout: 10_000 });
    await cm.click();
    await page.keyboard.type(" Flushed on switch.");

    // No debounce wait: jump to the second page and straight back. The edit must have been
    // flushed to the draft buffer on the way out, so it's still here on return.
    await page.getByRole("button", { name: "Second Page" }).click();
    await page.getByRole("button", { name: "Home", exact: true }).click();
    await expect(page.locator(".cm-content")).toContainText("Flushed on switch.", {
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

  // Publish results show as a toast (auto-dismissing, dismissible) — not the old persistent banner
  // that never went away. Publishing with no edits returns "No open edit session" with no GitHub
  // write, so it's a side-effect-free way to assert the toast wiring (provider mounted, useToast).
  test("publish shows a dismissible toast, not a persistent banner", async ({ page }) => {
    await page.goto(sitePath(SLUG, "editor"));
    await page.getByRole("button", { name: "Publish", exact: true }).click();

    const toast = page.getByText("No open edit session for this branch.");
    await expect(toast).toBeVisible();
    // Dismissible immediately (it also auto-dismisses on a timer). sonner labels its close "Close toast".
    await page.getByRole("button", { name: "Close toast" }).click();
    await expect(toast).toBeHidden();
  });

  // Regression gate for React-correctness bugs that a DOM/screenshot check can't see — only the
  // console can (this is exactly how the collaborative Visual editor's `flushSync`-during-render and
  // "Maximum update depth exceeded" render-loop bugs slipped past screenshot verification). Loading
  // the Visual editor and toggling modes exercises the re-seed (setContent) and awareness-nudge
  // paths that regressed; any React error here fails the build.
  test("the Visual editor loads and toggles modes with no React console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
    });

    await page.goto(sitePath(SLUG, "editor"));
    // Default is Visual (WYSIWYG).
    await expect(page.locator(".pv-visual .ProseMirror")).toBeVisible({ timeout: 10_000 });
    // Toggle Source ⇄ Visual — the mode swaps that re-seed content and (re)bind the carets plugin.
    await page.getByRole("button", { name: "Source mode" }).click();
    await expect(page.locator(".cm-content")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Visual mode" }).click();
    await expect(page.locator(".pv-visual .ProseMirror")).toBeVisible();
    // Let deferred effects flush (the queueMicrotask setContent + the one-shot awareness nudge).
    await page.waitForTimeout(500);

    const reactErrors = errors.filter(
      (e) =>
        e.startsWith("pageerror:") ||
        /flushSync|Maximum update depth|Cannot update a component|not wrapped in act|hydrat/i.test(e),
    );
    expect(reactErrors, `unexpected React errors:\n${reactErrors.join("\n")}`).toEqual([]);
  });

  // Publish panel: the file-changes list + per-file revert (SPEC §9.2). Edit one page, open the
  // Publish dropdown, and confirm it lists exactly that file with the right title (from
  // frontmatter) and "Modified" status — then revert it via the hover-revealed icon and confirm
  // both the draft row and the pane's content disappear, with no React console errors along the
  // way (this exact interaction path had a real setState-during-render bug during development).
  test("the Publish panel lists a changed file and reverts it back to the published content", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
    });

    await page.goto(sitePath(SLUG, "editor"));
    await page.getByRole("button", { name: "Source mode" }).click();
    const cm = page.locator(".cm-content");
    await expect(cm).toContainText("Original body text", { timeout: 10_000 });
    await cm.click();
    await page.keyboard.type(" A change to revert.");

    await expect
      .poll(
        async () => {
          const rows = await sql`
            select content from draft_file d
            join editor_session s on s.id = d.session_id
            where s.site_id = ${SITE_ID} and s.status = 'open' and d.path = 'index.mdx'`;
          return rows[0]?.content ?? "";
        },
        { timeout: 10_000 },
      )
      .toContain("A change to revert.");

    await page.getByRole("button", { name: "Publish options" }).click();
    const panel = page.getByRole("button", { name: "Revert Home" }).locator("..");
    await expect(page.getByText("1 file change", { exact: true })).toBeVisible();
    await expect(panel.getByText("Home", { exact: true })).toBeVisible();
    await expect(panel.getByText("Modified", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Revert Home" }).click();
    await expect(page.getByText("No changes yet")).toBeVisible();
    await expect(cm).toContainText("Original body text", { timeout: 10_000 });
    await expect(cm).not.toContainText("A change to revert.");

    await expect
      .poll(async () => {
        const rows = await sql`
          select 1 from draft_file d
          join editor_session s on s.id = d.session_id
          where s.site_id = ${SITE_ID} and s.status = 'open' and d.path = 'index.mdx'`;
        return rows.length;
      })
      .toBe(0);

    const reactErrors = errors.filter(
      (e) =>
        e.startsWith("pageerror:") ||
        /flushSync|Maximum update depth|Cannot update a component|not wrapped in act|hydrat/i.test(e),
    );
    expect(reactErrors, `unexpected React errors:\n${reactErrors.join("\n")}`).toEqual([]);
  });

  // Discard all changes (the coarse-grained sibling of per-file revert): edit two separate pages,
  // then wipe every draft in the session at once, gated by a confirm prompt.
  test("discard all changes clears every draft after confirming", async ({ page }) => {
    await page.goto(sitePath(SLUG, "editor"));
    await page.getByRole("button", { name: "Source mode" }).click();

    const cm = page.locator(".cm-content");
    await expect(cm).toContainText("Original body text", { timeout: 10_000 });
    await cm.click();
    await page.keyboard.type(" First edit.");

    // Switching pages flushes the pending edit (see the dedicated flush test above) before
    // this second edit lands its own draft.
    await page.getByRole("button", { name: "Second Page" }).click();
    await expect(cm).toContainText("The second page body", { timeout: 10_000 });
    await cm.click();
    await page.keyboard.type(" Second edit.");

    // Discard leaves a session's draftFile rows in place — it's a soft close (status →
    // 'discarded'), not a delete — so every count here is scoped to the OPEN session, matching
    // exactly what the app itself queries (findOpenSession). An unscoped count would also see
    // rows orphaned by an earlier discarded session and never reach 0.
    await expect
      .poll(async () => {
        const rows = await sql`
          select count(*)::int as n from draft_file d
          join editor_session s on s.id = d.session_id
          where s.site_id = ${SITE_ID} and s.status = 'open'`;
        return rows[0]?.n ?? 0;
      })
      .toBe(2);

    await page.getByRole("button", { name: "Publish options" }).click();
    await expect(page.getByText("2 file changes", { exact: true })).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    // Discard-all closes the panel itself on success (unlike a per-file revert, which keeps
    // it open) — reopen it to see the resulting empty state.
    await page.getByRole("button", { name: "Discard all changes" }).click();
    await page.getByRole("button", { name: "Publish options" }).click();
    await expect(page.getByText("No changes yet")).toBeVisible();

    await expect
      .poll(async () => {
        const rows = await sql`
          select count(*)::int as n from draft_file d
          join editor_session s on s.id = d.session_id
          where s.site_id = ${SITE_ID} and s.status = 'open'`;
        return rows[0]?.n ?? 0;
      })
      .toBe(0);
    await expect(cm).toContainText("The second page body", { timeout: 10_000 });
    await expect(cm).not.toContainText("Second edit.");
  });

  // Cross-machine remote carets in Visual mode (SPEC §9.2). Two independent browser contexts open
  // the same page; one's cursor must appear as a coloured, name-labelled caret in the other. This
  // needs the real collab service — same-browser BroadcastChannel doesn't sync cursor awareness,
  // and two Playwright contexts don't share a channel anyway — so it's gated on NEXT_PUBLIC_COLLAB_URL
  // (start apps/collab and export it; playwright.config forwards it to the app). Skips otherwise.
  test("shows a peer's caret in the other Visual editor when the collab service is configured", async ({
    browser,
  }) => {
    test.skip(
      !process.env.NEXT_PUBLIC_COLLAB_URL,
      "needs the collab service — set NEXT_PUBLIC_COLLAB_URL and start apps/collab",
    );
    const state = "tests/e2e/.auth/user.json";
    const ctxA = await browser.newContext({ storageState: state });
    const ctxB = await browser.newContext({ storageState: state });
    try {
      const a = await ctxA.newPage();
      const b = await ctxB.newPage();
      await a.goto(sitePath(SLUG, "editor"));
      await b.goto(sitePath(SLUG, "editor"));
      await expect(a.locator(".pv-visual .ProseMirror")).toBeVisible({ timeout: 10_000 });
      await expect(b.locator(".pv-visual .ProseMirror")).toBeVisible({ timeout: 10_000 });

      // A places its caret in the document; B should render A's remote caret + name label.
      await a.locator(".pv-visual .ProseMirror").click();
      await expect(b.locator(".pv-remote-caret")).toBeVisible({ timeout: 10_000 });
      await expect(b.locator(".pv-remote-caret-label").first()).toHaveText(/\w+/);
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });
});
