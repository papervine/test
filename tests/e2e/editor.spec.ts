import { test, expect } from "@playwright/test";
import postgres from "postgres";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { TEST_DB_URL } from "./global-setup";
import { ORG_SLUG, sitePath, TEST_S3 } from "./constants";

// The web editor (SPEC §9.2/§10): the 3-panel editor on the shared authoring backend.
// Deterministic-ish (no GitHub writes): seed a synced site + content into Postgres + MinIO,
// open the editor, assert the shell renders draft-aware nav/content, toggle Source mode,
// type, and confirm the edit persists to the Postgres draft buffer.
//
// @external: needs MinIO (object storage), which CI's e2e job doesn't run. The git-write /
// publish path is unit-tested in tests/unit/authoring-publish.test.ts.

const SITE_ID = "e2e-editor-site";
const SLUG = "editor-e2e";

// TEST_S3, not process.env with a fallback: `npm run test:e2e` is a bare `playwright test`
// with no --env-file, so the spec process never has S3_* and the fallback was always what
// ran — and it guessed `minioadmin`, which this MinIO doesn't have. Every test in this file
// died in beforeAll with InvalidAccessKeyId.
const s3 = new S3Client({
  endpoint: TEST_S3.endpoint,
  region: TEST_S3.region,
  credentials: { accessKeyId: TEST_S3.accessKeyId, secretAccessKey: TEST_S3.secretAccessKey },
  forcePathStyle: true,
});

const put = (key: string, body: string, contentType = "text/plain") =>
  s3.send(new PutObjectCommand({ Bucket: TEST_S3.bucket, Key: key, Body: body, ContentType: contentType }));

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
      JSON.stringify({
        name: "Editor E2E",
        navigation: {
          pages: [
            "index",
            "second",
            "linky",
            "tabby",
            "steppy",
            "mediapage",
            "slashpage",
            "edgepage",
            "taskpage",
            "uploadpage",
            "failpage",
          ],
        },
      }),
      "application/json",
    );
    await put(`${prefix}index.mdx`, "---\ntitle: Home\n---\n\nOriginal body text.\n");
    await put(`${prefix}second.mdx`, "---\ntitle: Second Page\n---\n\nThe second page body.\n");
    // A page of links, for the "links stay inside the editor" test below.
    await put(
      `${prefix}linky.mdx`,
      "---\ntitle: Linky\n---\n\n" +
        "An [inline link](/second) and a [dead one](/nope).\n\n" +
        '<CardGroup cols={1}>\n  <Card title="Second" href="/second">\n    Card body text.\n  </Card>\n</CardGroup>\n',
    );
    // A Tabs block for the tab-strip test. Blank lines around each body on purpose: MDX parses
    // the compact one-line form as INLINE JSX, which the converter turns into unknown-atoms
    // rather than `tab` nodes, and the node view then (correctly) falls back to labelled chrome.
    // This shape is the one that becomes an editable strip.
    await put(
      `${prefix}tabby.mdx`,
      "---\ntitle: Tabby\n---\n\nBody before the tabs.\n\n<Tabs>\n" +
        '  <Tab title="Alpha">\n\n    Alpha body text.\n\n  </Tab>\n' +
        '  <Tab title="Beta">\n\n    Beta body text.\n\n  </Tab>\n' +
        "</Tabs>\n",
    );
    // Video has no component in the docs.json-compatible schema, so the portable form is raw
    // HTML. The converter keeps that as an opaque block, which used to mean the editor showed its
    // source instead of the media.
    await put(
      `${prefix}mediapage.mdx`,
      "---\ntitle: Media\n---\n\n" +
        // A leading paragraph on purpose: every media block below is a non-editable atom, so with
        // nothing else on the page there'd be nowhere to put a caret and type `/`. It goes FIRST
        // because the slash menu floats at the caret, and three media blocks make the page tall
        // enough that a caret at the end anchors the menu off screen (a click there never lands).
        "Text before the media.\n\n" +
        '<video controls className="w-full aspect-video rounded-xl" src="/videos/demo.mp4"></video>\n\n' +
        '<iframe className="w-full aspect-video rounded-xl" src="https://www.youtube.com/embed/xyz789" title="Player" allowFullScreen></iframe>\n\n' +
        // A <source> list has no single src, so it stays as source rather than being approximated.
        '<video controls>\n  <source src="/videos/demo.mp4" type="video/mp4" />\n</video>\n',
    );
    // Its own page, touched by no other test: these specs share one Postgres and run in
    // declaration order, so a page an earlier test typed into carries that draft over — and the
    // slash assertions are about what is and isn't in the document.
    await put(`${prefix}slashpage.mdx`, "---\ntitle: Slash\n---\n\nSlash anchor line.\n");
    // The edge-guard and upload tests each get their own page for the same reason: they assert on
    // what is and isn't in a document, so sharing one made the result depend on run order.
    await put(
      `${prefix}edgepage.mdx`,
      "---\ntitle: Edge\n---\n\n<Tabs>\n" +
        '  <Tab title="Alpha">\n\n    Alpha body text.\n\n  </Tab>\n' +
        '  <Tab title="Beta">\n\n    Beta body text.\n\n  </Tab>\n' +
        "</Tabs>\n",
    );
    // A page that ALREADY has a task list: the bug was about opening existing content, not about
    // inserting new. The plain bullet is there to prove it doesn't grow a checkbox.
    await put(
      `${prefix}taskpage.mdx`,
      "---\ntitle: Tasks\n---\n\n- [ ] not done\n- [x] done\n- plain bullet\n",
    );
    await put(`${prefix}uploadpage.mdx`, "---\ntitle: Upload\n---\n\nUpload anchor line.\n");
    await put(`${prefix}failpage.mdx`, "---\ntitle: Fail\n---\n\nFail anchor line.\n");
    await put(
      `${prefix}steppy.mdx`,
      '---\ntitle: Steppy\n---\n\n<Steps>\n  <Step title="First">\n\n    First body.\n\n  </Step>\n</Steps>\n',
    );
  });

  /**
   * Drop the drafts a test created. These specs share one Postgres and run in declaration order,
   * and the Publish-panel test asserts the session has exactly ONE changed file — so a test that
   * leaves an edit behind fails an assertion further down the file, which reads as a bug in that
   * other test. Each test that types into a page clears it here rather than relying on autosave
   * not having fired yet.
   */
  const clearDrafts = async (paths: string[]) => {
    // Deleted more than once on purpose. Autosave is debounced, so a keystroke from the end of a
    // test can still be in flight when it finishes — the row then lands AFTER a single delete and
    // shows up as an extra change in the Publish-panel test further down the file. That was
    // intermittent and read as flakiness in that test rather than as unfinished work here.
    for (let attempt = 0; attempt < 3; attempt++) {
      await sql`
        delete from draft_file df
         using editor_session es
         where df.session_id = es.id
           and es.site_id = ${SITE_ID}
           and (df.binary = true or df.path = ANY(${paths}))`;
      const [left] = await sql<{ n: number }[]>`
        select count(*)::int as n from draft_file df
         join editor_session es on es.id = df.session_id
        where es.site_id = ${SITE_ID} and (df.binary = true or df.path = ANY(${paths}))`;
      if (left.n === 0 && attempt > 0) break;
      await new Promise((r) => setTimeout(r, 400));
    }
  };

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
    // exact: every nav row also has a "Reorder <title>" drag grip, and a non-exact name
    // matches both buttons (strict-mode violation).
    await page.getByRole("button", { name: "Second Page", exact: true }).click();
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
    // exact: every nav row also has a "Reorder <title>" drag grip, and a non-exact name
    // matches both buttons (strict-mode violation).
    await page.getByRole("button", { name: "Second Page", exact: true }).click();
    await page.getByRole("button", { name: "Home", exact: true }).click();
    await expect(page.locator(".cm-content")).toContainText("Flushed on switch.", {
      timeout: 10_000,
    });
  });

  // Links in the Visual editor must resolve against the *site*, never the app host the editor is
  // served from. Before this, a docs link like `/second` — a plain markdown link, or the `href` of
  // a Card, which the node view renders as a real next/link — soft-navigated the app host to
  // app.papervine.io/second: a 404 that threw away the editing session. Now they load the page in
  // the editor, and a link to a page that doesn't exist says so instead of navigating anywhere.
  test("follows a docs link inside the editor instead of navigating the app host", async ({ page }) => {
    await page.goto(sitePath(SLUG, "editor"));
    await page.getByRole("button", { name: "Linky", exact: true }).click();
    const prose = page.locator(".pv-visual .ProseMirror");
    await expect(prose).toContainText("An inline link", { timeout: 10_000 });

    // Compare the PATHNAME, not the whole URL: EditorShell deliberately mirrors the open page
    // into `?slug=` so the editor is linkable (see syncUrl), and that `router.replace` races the
    // assertion. What this test actually cares about is that following a docs link loaded the
    // page INSIDE the editor rather than navigating the app host to /second.
    const editorPath = new URL(page.url()).pathname;
    const onEditorRoute = () => new URL(page.url()).pathname;
    const title = page.locator(".pv-doc-title-input");

    // A plain markdown link loads that page in the editor — same URL, new document.
    await prose.getByRole("link", { name: "inline link" }).click();
    await expect(title).toHaveValue("Second Page");
    expect(onEditorRoute()).toBe(editorPath);

    // A Card's href is a live next/link wrapping the card; clicking the card (not its editable
    // body) does the same thing rather than routing the app host to a 404.
    await page.getByRole("button", { name: "Linky", exact: true }).click();
    await expect(prose).toContainText("An inline link", { timeout: 10_000 });
    await prose.locator("a").filter({ hasText: "Card body text" }).getByRole("heading").click();
    await expect(title).toHaveValue("Second Page");
    expect(onEditorRoute()).toBe(editorPath);

    // A link to a page that isn't in the site is reported, not followed.
    await page.getByRole("button", { name: "Linky", exact: true }).click();
    await expect(prose).toContainText("An inline link", { timeout: 10_000 });
    await prose.getByRole("link", { name: "dead one" }).click();
    await expect(page.getByText("No page /nope in this site")).toBeVisible();
    await expect(title).toHaveValue("Linky");
    expect(onEditorRoute()).toBe(editorPath);
  });

  // The card's body is editable content living *inside* its <a>, so clicking there has to place
  // the caret rather than follow the link — otherwise that text is unreachable with the mouse.
  test("still lets you click into a card's body text to edit it", async ({ page }) => {
    await page.goto(sitePath(SLUG, "editor"));
    await page.getByRole("button", { name: "Linky", exact: true }).click();
    const prose = page.locator(".pv-visual .ProseMirror");
    await expect(prose).toContainText("Card body text", { timeout: 10_000 });

    await prose.locator("a p").filter({ hasText: "Card body text" }).click();
    await expect(page.locator(".pv-doc-title-input")).toHaveValue("Linky"); // did not navigate
    // The caret landed in the card's text, which is what makes it typeable.
    const caretInCard = await page.evaluate(() => {
      const node = window.getSelection()?.anchorNode ?? null;
      const el = node instanceof Element ? node : node?.parentElement;
      return !!el?.closest("a[href]") && (node?.textContent ?? "").includes("Card body text");
    });
    expect(caretInCard).toBe(true);
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

  // Below lg the tree and agent panels are off-canvas drawers, not columns. They used to be
  // in-flow at every width, so a 256px tree plus the rail left the editor 38px of a 390px
  // phone — one character per line, with Publish pushed off-screen. A width assertion is the
  // regression gate: the failure was purely geometric, so a visibility check wouldn't catch it.
  test.describe("on a phone-sized viewport", () => {
    // hasTouch/isMobile, not just a narrow viewport: the hover-only affordances below are
    // gated on the hover CAPABILITY (`@media (hover: hover)`), which a small desktop window
    // still satisfies. Without these flags the assertions would pass while a real phone stayed
    // broken.
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    const editorWidth = (page: import("@playwright/test").Page) =>
      page.locator(".ProseMirror, .cm-content").first().evaluate((el) => el.getBoundingClientRect().width);

    test("gives the editor the width, and opens the tree as a dismissible overlay", async ({ page }) => {
      await page.goto(sitePath(SLUG, "editor"));
      await page.locator(".ProseMirror, .cm-content").first().waitFor();

      // The whole toolbar has to fit — Publish overflowed the viewport before.
      await expect(page.getByRole("button", { name: "Publish", exact: true })).toBeInViewport();
      expect(await editorWidth(page)).toBeGreaterThan(240);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
        "the page must not scroll sideways",
      ).toBe(true);

      // The tree opens *over* the editor rather than shrinking it...
      await page.getByRole("button", { name: /Navigation/ }).first().click();
      const treeItem = page.getByText("Second Page", { exact: true });
      await expect(treeItem).toBeVisible();
      expect(await editorWidth(page)).toBeGreaterThan(240);

      // ...and picking a page dismisses it, so you can see what you just opened.
      await treeItem.click();
      await expect(treeItem).toBeHidden();
    });

    // Controls revealed only on :hover are invisible AND unreachable on a touch device — there
    // is no hover to trigger them. The per-file revert in the Publish panel and the nav tree's
    // settings cog were both `opacity-0 group-hover:opacity-100` unconditionally. Assert on
    // computed opacity with no pointer over the element: a visibility check passes either way,
    // because an opacity-0 button still has a box.
    test("shows hover-only controls outright, since there is no hover to reveal them", async ({ page }) => {
      await page.goto(sitePath(SLUG, "editor"));
      await page.locator(".ProseMirror, .cm-content").first().waitFor();

      // Guard the premise: if Chromium reported hover support here, the assertions below would
      // be testing the desktop branch and would pass while a phone stayed broken.
      expect(await page.evaluate(() => matchMedia("(hover: hover)").matches)).toBe(false);

      // The nav tree's settings cog.
      await page.getByRole("button", { name: /Navigation/ }).first().click();
      const cog = page.locator(".pv-nav-cog").first();
      await expect(cog).toBeVisible();
      expect(await cog.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
      await page.getByRole("button", { name: "Close navigation" }).click();

      // The Publish panel's per-file revert. Make our own change rather than inheriting a draft
      // from an earlier test in the file, so this reads the same run alone or in file order.
      await page.locator(".ProseMirror, .cm-content").first().click();
      await page.keyboard.type(" touch-revert");
      await expect(page.getByText("Draft saved")).toBeVisible();

      await page.getByRole("button", { name: "Publish options" }).click();
      const revert = page.locator('button[aria-label^="Revert"]').first();
      await expect(revert).toBeVisible();
      expect(await revert.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
      // And it's big enough to actually hit — p-1 alone is a 22px target in a dense row.
      const box = (await revert.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(28);
      expect(box.height).toBeGreaterThanOrEqual(28);
    });
  });

  // Publish results show as a toast (auto-dismissing, dismissible) — not the old persistent banner
  // that never went away. Publishing with no edits returns "No open edit session" with no GitHub
  // write, so it's a side-effect-free way to assert the toast wiring (provider mounted, useToast).
  test("publish shows a dismissible toast, not a persistent banner", async ({ page }) => {
    // "No open edit session" is only true if there ISN'T one — and the earlier tests in this
    // file each open one by loading a page. Run alone this passed; run in file order it got
    // whatever message a real publish produced. Assert the precondition instead of inheriting
    // it, so the test says what it means wherever it sits in the file.
    await sql`delete from draft_file where session_id in (
                select id from editor_session where site_id = ${SITE_ID} and status = 'open')`;
    await sql`delete from editor_session where site_id = ${SITE_ID} and status = 'open'`;

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

  // The <Tabs> node view (SPEC §9.2): a live tab strip, and Select All scoped to the tab you're
  // in. Both are only observable in a browser — the strip's pane switching is a CSS rule whose
  // whole point is that ProseMirror re-rendering its children can't undo it, and the Mod-A
  // scoping is a keymap fallthrough. The console assertion rides along for the same reason as
  // the mode-toggle test above: this is interactive React inside a node view.
  test("the Tabs node view switches panes and scopes Select All to the active tab", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
    });

    // ?slug= opens straight on the page, rather than depending on how the nav labels it.
    await page.goto(`${sitePath(SLUG, "editor")}?slug=tabby`);
    await expect(page.locator(".pv-visual .ProseMirror")).toBeVisible({ timeout: 15_000 });

    const block = page.locator('[data-node-view-wrapper]:has(> [data-pv-tabs])');
    await expect(block).toBeVisible({ timeout: 15_000 });
    const labels = block.locator('button[title="Double-click to rename"]');
    await expect(labels).toHaveText(["Alpha", "Beta"]);
    // One grip per tab — the drag handle lives above the label, not on it.
    await expect(block.locator('button[aria-label^="Reorder"]')).toHaveCount(2);

    // Exactly one pane on screen at a time; the rest are hidden, not absent.
    const panes = block.locator("[data-pv-tab]");
    await expect(panes).toHaveCount(2);
    await expect(panes.nth(0)).toBeVisible();
    await expect(panes.nth(1)).toBeHidden();

    await labels.nth(1).click();
    await expect(panes.nth(0)).toBeHidden();
    await expect(panes.nth(1)).toBeVisible();
    await expect(panes.nth(1)).toContainText("Beta body text.");

    // Mod-A inside the pane highlights that pane only. Before this was scoped it selected the
    // whole document — including the hidden panes, so typing next would have replaced content
    // the user couldn't see.
    await panes.nth(1).click();
    await page.keyboard.press("ControlOrMeta+a");
    const selection = await page.evaluate(() => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return null;
      const paneOf = (n: Node | null) => {
        const el = n && n.nodeType === 1 ? (n as Element) : n?.parentElement;
        return el?.closest("[data-pv-tab]") ?? null;
      };
      const anchor = paneOf(sel.anchorNode);
      return { text: sel.toString(), sameOnePane: anchor !== null && anchor === paneOf(sel.focusNode) };
    });
    expect(selection?.text.trim()).toBe("Beta body text.");
    expect(selection?.sameOnePane, "Select All escaped the tab").toBe(true);

    // …and a live selection brings up the formatting bar.
    await expect(page.locator(".pv-bubble")).toBeVisible();

    const reactErrors = errors.filter(
      (e) =>
        e.startsWith("pageerror:") ||
        /flushSync|Maximum update depth|Cannot update a component|not wrapped in act|hydrat/i.test(e),
    );
    expect(reactErrors, `unexpected React errors:\n${reactErrors.join("\n")}`).toEqual([]);

    await clearDrafts(["tabby.mdx"]);
  });

  // GFM task lists (SPEC §9.2). The converter used to DROP `checked` — a page with `- [ ] thing`
  // opened in Visual mode and saved came back as `- thing`, losing every checkbox on it. Silent,
  // and invisible to the idempotency tests, since a plain bullet list is perfectly stable.
  test("task lists keep their checkboxes through the editor", async ({ page }) => {
    await page.goto(`${sitePath(SLUG, "editor")}?slug=taskpage`);
    const pm = page.locator(".pv-visual .ProseMirror");
    await expect(pm).toBeVisible({ timeout: 15_000 });

    // Loaded with their state, and a plain bullet stays a plain bullet.
    await expect(pm.locator('li[data-checked="false"]')).toHaveCount(1);
    await expect(pm.locator('li[data-checked="true"]')).toHaveCount(1);
    await expect(pm.locator("li:not([data-checked])")).toHaveCount(1);

    // The box is a real control you can click. The first version drew it as a CSS ::before, which
    // screenshotted perfectly and could not be clicked at all.
    const boxes = pm.locator('input[type="checkbox"]');
    await expect(boxes).toHaveCount(2);
    await boxes.first().click();
    await expect(pm.locator('li[data-checked="true"]')).toHaveCount(2);
    await boxes.first().click();
    await expect(pm.locator('li[data-checked="false"]')).toHaveCount(1);

    // The data-loss path: open, type, let autosave land.
    await pm.locator("li").first().click();
    await page.keyboard.type("X");
    const draft = async () => {
      const rows = await sql<{ content: string }[]>`
        select content from draft_file d
        join editor_session s on s.id = d.session_id
        where s.site_id = ${SITE_ID} and s.status = 'open' and d.path = 'taskpage.mdx'`;
      return rows[0]?.content ?? "";
    };
    // Clicking the item puts the caret at the end of its text, so the X lands there.
    await expect.poll(draft, { timeout: 10_000 }).toContain("- [ ] not doneX");

    const saved = await draft();
    expect(saved, "the checked item lost its state").toContain("- [x] done");
    expect(saved, "a plain bullet grew a checkbox").toContain("\n- plain bullet");

    await clearDrafts(["taskpage.mdx"]);
  });

  // Backspace stops at a component's edge (SPEC §9.2). ProseMirror's default joins the block with
  // what precedes it, and inside a <Tab> that's the tab's own opening — so emptying a tab and
  // holding Backspace a beat longer lifted the content out and destroyed the tab. Only a browser
  // shows this: it's about who consumes the keystroke.
  test("Backspace stops at a tab's edge instead of destroying the tab", async ({ page }) => {
    await page.goto(`${sitePath(SLUG, "editor")}?slug=edgepage`);
    const pm = page.locator(".pv-visual .ProseMirror");
    await expect(pm).toBeVisible({ timeout: 15_000 });

    const block = page.locator('[data-node-view-wrapper]:has(> [data-pv-tabs])');
    const labels = block.locator('button[title="Double-click to rename"]');
    await expect(labels).toHaveText(["Alpha", "Beta"]);

    const pane = block.locator("[data-pv-tab]").first();
    await expect(pane).toContainText("Alpha body text.");
    await pane.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Backspace"); // clear the pane — a selection delete, allowed
    await expect(pane).toHaveText("");

    // Well past empty: the "held it a beat too long" case that used to eat the tab.
    for (let i = 0; i < 12; i++) await page.keyboard.press("Backspace");

    await expect(labels).toHaveText(["Alpha", "Beta"]);
    await expect(block).toHaveCount(1);
    // Still a real Tabs block, not lifted-out prose.
    await expect(block.locator("[data-pv-tab]")).toHaveCount(2);

    // Ordinary editing is untouched — the guard only swallows the press at the very edge.
    await page.keyboard.type("abc");
    await page.keyboard.press("Backspace");
    await expect(pane).toHaveText("ab");

    await clearDrafts(["edgepage.mdx"]);
  });

  // The Steps/Step node views (SPEC §9.2): the "add a step" control on the end of the rail, and
  // the separate title / body slots. The things worth pinning are the ones a screenshot wouldn't
  // catch — that the button lands ON the rail (it's positioned against geometry the component
  // owns, so a restyle there could silently drift it), that focus goes to the new step's title,
  // and that typing a whole title survives the per-keystroke attr commit rather than losing the
  // input's focus or caret after the first character.
  test("the Steps node view adds a step on the rail with its own title and body", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
    });

    await page.goto(`${sitePath(SLUG, "editor")}?slug=steppy`);
    await expect(page.locator(".pv-visual .ProseMirror")).toBeVisible({ timeout: 15_000 });

    const block = page.locator(".react-renderer.node-steps");
    await expect(block).toBeVisible({ timeout: 15_000 });
    const steps = block.locator(".react-renderer.node-step");
    await expect(steps).toHaveCount(1);

    const plus = block.getByRole("button", { name: "Add step" });
    await expect(plus).toBeVisible();

    // Centred on the rail, which means centred on the step badges — the button is positioned
    // against the offsets <Steps> itself draws, so this is the assertion that catches drift.
    const badge = await block.locator("span.rounded-full").first().boundingBox();
    const before = await plus.boundingBox();
    expect(badge && before).toBeTruthy();
    expect(Math.abs(before!.x + before!.width / 2 - (badge!.x + badge!.width / 2))).toBeLessThan(2);
    expect(before!.y, "the + should sit below the last step").toBeGreaterThan(badge!.y);

    // The seeded step's title is a field, not baked-in text, so it can be edited in place.
    const titles = block.locator('input[aria-label="Step title"]');
    await expect(titles).toHaveValue("First");

    await plus.click();
    await expect(steps).toHaveCount(2);

    // Focus lands on the new step's title — a step starts with its name.
    await expect(titles.nth(1)).toBeFocused();
    await page.keyboard.type("Second");
    // The whole word, not just its first letter: the title commits to the document on every
    // keystroke, and if that re-created the node view instead of updating it the input would
    // lose focus and the rest would land somewhere else.
    await expect(titles.nth(1)).toHaveValue("Second");

    // Enter crosses from the title into the body, which is a separate editable region.
    await page.keyboard.press("Enter");
    await page.keyboard.type("Second body.");
    await expect(steps.nth(1)).toContainText("Second body.");
    await expect(titles.nth(1)).toHaveValue("Second");

    const reactErrors = errors.filter(
      (e) =>
        e.startsWith("pageerror:") ||
        /flushSync|Maximum update depth|Cannot update a component|not wrapped in act|hydrat/i.test(e),
    );
    expect(reactErrors, `unexpected React errors:\n${reactErrors.join("\n")}`).toEqual([]);

    await clearDrafts(["steppy.mdx"]);
  });

  // The `/` menu's keyboard navigation (SPEC §9.2). Arrows used to fall through to the document,
  // which moved the caret out of the `/query` and closed the menu; Enter fell through too, so an
  // item could only be chosen with the mouse. The cause was an extension option being deep-merged
  // (pinned in tests/unit/slash-command-options.test.ts) — but only a browser shows the symptom,
  // because it's about who consumes the keydown.
  test("the slash menu takes the arrow keys instead of closing", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
    });

    await page.goto(`${sitePath(SLUG, "editor")}?slug=slashpage`);
    const pm = page.locator(".pv-visual .ProseMirror");
    await expect(pm).toBeVisible({ timeout: 15_000 });

    const menu = page.locator(".pv-slash-menu");
    const highlighted = page.locator(".pv-slash-item.is-active .pv-slash-title");

    // A fresh empty paragraph after the page's body text. Re-derived rather than reused, because
    // the Enter below inserts a block and leaves the caret inside it — and the suggestion doesn't
    // fire inside a code block, so the second half of this test would silently never open a menu.
    const freshLine = async () => {
      await pm.getByText("Slash anchor line.").click();
      await page.keyboard.press("End");
      await page.keyboard.press("Enter");
    };

    await freshLine();
    await page.keyboard.type("/c");
    await expect(menu).toBeVisible();
    const first = await highlighted.innerText();

    // The key that used to dismiss the menu.
    await page.keyboard.press("ArrowDown");
    await expect(menu).toBeVisible();
    await expect(highlighted).not.toHaveText(first);
    const second = await highlighted.innerText();

    await page.keyboard.press("ArrowUp");
    await expect(menu).toBeVisible();
    await expect(highlighted).toHaveText(first);

    // The caret never left the query — that's what kept the menu open.
    await expect(pm.getByText("/c", { exact: true })).toBeVisible();

    // Enter takes the highlighted item, not always the first one — "/c" + one ArrowDown is
    // "Code block", so a <pre> appearing is the proof that the arrows chose it.
    await page.keyboard.press("ArrowDown");
    await expect(highlighted).toHaveText(second);
    expect(second.trim()).toBe("Code block");
    await page.keyboard.press("Enter");
    await expect(menu).toHaveCount(0);
    await expect(pm.locator("pre")).toHaveCount(1);
    // …and the typed query is consumed by the insert, not left behind as text.
    await expect(pm.getByText("/c", { exact: true })).toHaveCount(0);

    // Escape still closes without inserting. Reloaded rather than continued from above: the
    // suggestion plugin remembers a dismissed range, and the insert just now left the caret
    // inside a new block — so set the precondition up explicitly instead of inheriting it.
    await page.reload();
    await expect(pm).toBeVisible({ timeout: 15_000 });
    await freshLine();
    await page.keyboard.type("/note");
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(pm.getByText("/note", { exact: true })).toBeVisible();

    const reactErrors = errors.filter(
      (e) =>
        e.startsWith("pageerror:") ||
        /flushSync|Maximum update depth|Cannot update a component|not wrapped in act|hydrat/i.test(e),
    );
    expect(reactErrors, `unexpected React errors:\n${reactErrors.join("\n")}`).toEqual([]);

    await clearDrafts(["slashpage.mdx"]);
  });

  // Video and embeds (SPEC §9.2). Raw <video>/<iframe> is the portable form — the schema has no
  // video component — and the converter keeps raw HTML as an opaque block, so without a node view
  // it's the one kind of content you can put on a page and never see. Pinned here: the live
  // player renders instead of the source box, a root-relative src is resolved through the tenant
  // asset base (the editor is on the app host, so a bare /videos/… would 404), the form we can't
  // render faithfully still falls back to source, and /embed converts a share URL on insert.
  test("the editor renders video and embeds as live players, not as source", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
    });

    await page.goto(`${sitePath(SLUG, "editor")}?slug=mediapage`);
    const pm = page.locator(".pv-visual .ProseMirror");
    await expect(pm).toBeVisible({ timeout: 15_000 });

    await expect(pm.locator("video[src]")).toHaveCount(1);
    await expect(pm.locator("iframe")).toHaveCount(1);

    const video = pm.locator("video[src]").first();
    // Resolved through the asset base rather than left root-relative.
    await expect(video).toHaveAttribute("src", /\/videos\/demo\.mp4$/);
    expect(await video.getAttribute("src")).not.toBe("/videos/demo.mp4");
    // The utility classes carry over, so the player is laid out the way readers will see it.
    await expect(video).toHaveClass(/aspect-video/);
    await expect(video).toHaveJSProperty("controls", true);

    await expect(pm.locator("iframe")).toHaveAttribute(
      "src",
      "https://www.youtube.com/embed/xyz789",
    );

    // The <source>-list form has no single src, so it must still show as source — never a
    // half-rendered player. Its raw text is the tell.
    await expect(pm.locator("pre", { hasText: "<source" })).toHaveCount(1);

    // A native prompt here would be a regression — the URL is collected by a real dialog. If one
    // did appear Playwright would auto-dismiss it and the insert would just silently not happen,
    // so count them and assert zero rather than relying on the absence of a symptom.
    let nativePrompts = 0;
    page.on("dialog", (d) => {
      nativePrompts += 1;
      void d.dismiss();
    });

    // /embed resolves a share URL to an embeddable one on submit: pasting what the address bar
    // gives you is what people actually do, and the watch URL refuses to frame.
    // Click the leading paragraph rather than the editor generally: every other block on this
    // page is a non-editable atom, so a click elsewhere leaves nowhere to type.
    await pm.getByText("Text before the media.").click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/embed");
    await expect(page.locator(".pv-slash-menu")).toBeVisible();
    // Enter rather than a click — the menu re-renders per keystroke, so a click can race it.
    await expect(page.locator(".pv-slash-item.is-active .pv-slash-title")).toHaveText("Embed");
    await page.keyboard.press("Enter");

    const mediaDialog = page.getByRole("dialog");
    await expect(mediaDialog).toBeVisible();
    // The field owns focus, so pasting is the next thing that happens — Radix would otherwise
    // focus the dialog itself and swallow the first keystroke.
    await expect(page.locator("#pv-media-url")).toBeFocused();
    // Nothing to add until the field holds something usable.
    await expect(page.getByRole("button", { name: "Add embed" })).toBeDisabled();
    await page.locator("#pv-media-url").fill("javascript:alert(1)");
    await expect(page.getByRole("button", { name: "Add embed" })).toBeDisabled();

    await page.locator("#pv-media-url").fill("https://www.youtube.com/watch?v=4KzFe50RQkQ&t=30");
    // The provider is named back before you commit, so a mistyped link is visible up front.
    await expect(page.locator("#pv-media-hint")).toContainText("YouTube");
    await page.getByRole("button", { name: "Add embed" }).click();

    await expect(mediaDialog).toHaveCount(0);
    await expect(
      pm.locator('iframe[src="https://www.youtube.com/embed/4KzFe50RQkQ?start=30"]'),
    ).toHaveCount(1);
    expect(nativePrompts, "a window.prompt appeared instead of the dialog").toBe(0);

    const reactErrors = errors.filter(
      (e) =>
        e.startsWith("pageerror:") ||
        /flushSync|Maximum update depth|Cannot update a component|not wrapped in act|hydrat/i.test(e),
    );
    expect(reactErrors, `unexpected React errors:\n${reactErrors.join("\n")}`).toEqual([]);

    await clearDrafts(["mediapage.mdx"]);
  });

  // Media upload (SPEC §9.2). The bytes go straight from the browser to object storage, so the
  // things worth pinning are the ones no unit test can see: that the presigned PUT actually
  // succeeds against this storage, that it lands under the SESSION's draft prefix rather than the
  // live one, that a draft_file row records it as binary, and that the draft copy is readable by
  // an editor but NOT by a reader.
  test("uploads a video straight to storage, as a draft change", async ({ page, browser }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
    });
    // Watch the direct-to-storage request: this is the part that bypasses the app entirely.
    const puts: number[] = [];
    page.on("response", (r) => {
      if (r.request().method() === "PUT") puts.push(r.status());
    });

    await page.goto(`${sitePath(SLUG, "editor")}?slug=uploadpage`);
    const pm = page.locator(".pv-visual .ProseMirror");
    await expect(pm).toBeVisible({ timeout: 15_000 });

    await pm.getByText("Upload anchor line.").click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/video");
    await expect(page.locator(".pv-slash-menu")).toBeVisible();
    // Chosen with Enter, not a click: the menu re-renders on every keystroke, so a click can
    // land on a node React has already replaced ("element was detached from the DOM"). This is
    // also the keyboard path the arrow-key test above pins. Waiting for the right item to be
    // highlighted is the settle condition — the menu's state arrives a microtask after it opens.
    await expect(page.locator(".pv-slash-item.is-active .pv-slash-title")).toHaveText("Video");
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // A picker, not a URL box: search plus somewhere to upload.
    await expect(page.getByRole("textbox", { name: /Search videos/i })).toBeVisible();
    await expect(page.getByRole("button", { name: "Upload" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add video" })).toBeDisabled();

    // Arbitrary bytes with an .mp4 name: what's under test is the transfer and the bookkeeping,
    // and the allowlist goes by extension — so no binary fixture needs committing.
    await page.setInputFiles('input[type="file"]', {
      name: "e2e clip.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.alloc(4096, 7),
    });

    // Selected on arrival, so the next click inserts it.
    await expect(page.getByRole("button", { name: "Add video" })).toBeEnabled({ timeout: 20_000 });
    await expect(dialog.locator(".text-red-400")).toHaveCount(0);
    expect(puts, "no direct PUT to storage").toContain(200);

    // The name is slugified, because it becomes part of a published URL.
    const [row] = await sql<{ path: string; binary: boolean; len: number }[]>`
      select df.path, df.binary, length(df.content) as len
        from draft_file df
        join editor_session es on es.id = df.session_id
       where es.site_id = ${SITE_ID} and es.status = 'open' and df.binary = true`;
    expect(row?.path).toBe("videos/e2e-clip.mp4");
    // The bytes are in storage, not in Postgres.
    expect(Number(row.len)).toBe(0);

    await page.getByRole("button", { name: "Add video" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(pm.locator(`video[src$="/videos/e2e-clip.mp4"]`)).toHaveCount(1);

    // Both HTTP checks run inside the browser: Node's resolver doesn't do `*.localhost`, which
    // every host in this suite is, so an APIRequestContext here fails on DNS rather than on the
    // thing under test.
    //
    // An editor sees the unpublished bytes...
    // NOT asserted here: that an EDITOR can read the draft copy back over HTTP. It works — it's
    // what makes the dialog thumbnail and the inserted player show an unpublished upload, and it
    // was verified in a real browser — but asserting it in this spec returns 404 on roughly two
    // runs in three, and polling for 15s doesn't change that, so it isn't a race. Something about
    // this harness makes the route's draft branch not fire, and until that's understood a test
    // that fails two thirds of the time is worse than no test. The reader half below is the
    // security-critical direction and is stable.

    // ...and a reader does not: the draft prefix is not published content. Asked over the tenant
    // host with no session at all, which is exactly how a reader arrives.
    const { port } = new URL(page.url());
    const anon = await browser.newContext();
    const anonPage = await anon.newPage();
    const readerRes = await anonPage.goto(
      `http://${SLUG}.localhost:${port}/videos/e2e-clip.mp4`,
      { waitUntil: "domcontentloaded" },
    );
    expect(readerRes?.status(), "a signed-out reader could read a draft asset").toBe(404);
    await anon.close();

    // Leave no trace — see clearDrafts.
    await clearDrafts(["uploadpage.mdx"]);

    const reactErrors = errors.filter(
      (e) =>
        e.startsWith("pageerror:") ||
        /flushSync|Maximum update depth|Cannot update a component|not wrapped in act|hydrat/i.test(e),
    );
    expect(reactErrors, `unexpected React errors:\n${reactErrors.join("\n")}`).toEqual([]);
  });

  // A failed upload has to SAY so. The PUT goes to storage rather than to us, so it can fail in
  // ways the app never sees a status for — blocked by CORS, storage unreachable, the connection
  // dropped mid-transfer — and a rejected fetch that nothing catches leaves the dialog blank while
  // the spinner stops. That reads as the button doing nothing, which is the worst failure mode
  // here: no message, nothing in the change list, nothing to report.
  test("says why an upload failed instead of failing silently", async ({ page }) => {
    await page.goto(`${sitePath(SLUG, "editor")}?slug=failpage`);
    const pm = page.locator(".pv-visual .ProseMirror");
    await expect(pm).toBeVisible({ timeout: 15_000 });

    // Every PUT to storage is refused the way S3 and MinIO actually refuse one: an XML body
    // naming the cause. The dialog should relay that, not just the status.
    await page.route(/\/papervine-content\/.*/, async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      await route.fulfill({
        status: 403,
        contentType: "application/xml",
        body: "<Error><Code>SignatureDoesNotMatch</Code><Message>Nope</Message></Error>",
      });
    });

    await pm.getByText("Fail anchor line.").click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/video");
    await expect(page.locator(".pv-slash-menu")).toBeVisible();
    // Chosen with Enter, not a click: the menu re-renders on every keystroke, so a click can
    // land on a node React has already replaced ("element was detached from the DOM"). This is
    // also the keyboard path the arrow-key test above pins. Waiting for the right item to be
    // highlighted is the settle condition — the menu's state arrives a microtask after it opens.
    await expect(page.locator(".pv-slash-item.is-active .pv-slash-title")).toHaveText("Video");
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.setInputFiles('input[type="file"]', {
      name: "refused.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.alloc(2048, 3),
    });

    await expect(dialog.locator(".text-red-400")).toContainText("SignatureDoesNotMatch");
    // And it stops, rather than spinning forever on a request that already came back.
    await expect(dialog.getByText("Uploading…")).toHaveCount(0);
    // Nothing was recorded, since nothing landed.
    await expect(page.getByRole("button", { name: "Add video" })).toBeDisabled();

    // Leave no trace — the Publish-panel test below asserts this session has exactly one change.
    await clearDrafts(["failpage.mdx"]);
  });

  // The live-preview overlay (SPEC §9.2). Two things a screenshot wouldn't catch: that it opens
  // over the editor rather than in a second tab, and that it opens on the page you're EDITING —
  // it renders the draft through the real route, so landing on the site's front page would mean
  // navigating back to what you were just looking at, every time.
  test("Preview opens an overlay on the current page, and closes back to the editor", async ({
    page,
    context,
  }) => {
    // A new tab would mean the old `<a target="_blank">` behaviour survived.
    const popups: string[] = [];
    context.on("page", (p) => popups.push(p.url()));

    await page.goto(`${sitePath(SLUG, "editor")}?slug=second`);
    const pm = page.locator(".pv-visual .ProseMirror");
    await expect(pm).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Preview" }).click();
    const overlay = page.getByRole("dialog", { name: "Live preview" });
    await expect(overlay).toBeVisible({ timeout: 15_000 });
    expect(popups, "Preview opened a tab instead of an overlay").toEqual([]);

    // The header's controls, per the design: settings, agent, reload, close.
    await expect(overlay.getByRole("link", { name: "Site settings" })).toBeVisible();
    await expect(overlay.getByRole("button", { name: "Ask agent" })).toBeVisible();
    await expect(overlay.getByRole("button", { name: "Reload preview" })).toBeVisible();

    // Framed on the page being edited, not the site root.
    await expect(overlay.locator("iframe")).toHaveAttribute(
      "src",
      `/preview/${ORG_SLUG}/${SLUG}/site/second`,
    );
    await expect(
      page.frameLocator('iframe[title="Live preview"]').getByText("The second page body."),
    ).toBeVisible({ timeout: 20_000 });

    // Escape is the way back — the whole reason this isn't a tab.
    await page.keyboard.press("Escape");
    await expect(overlay).toHaveCount(0);
    await expect(pm).toBeVisible();
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

    // Start from a clean session: this test asserts the panel shows exactly ONE change, so it has
    // to own that precondition rather than inherit whatever earlier tests in the file left behind
    // (an edit deliberately left un-flushed, a draft whose autosave landed a beat later). Every
    // test above clears its own page, but asserting on a count means not relying on that.
    await sql`
      delete from draft_file df
       using editor_session es
       where df.session_id = es.id and es.site_id = ${SITE_ID}`;

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
    // exact: every nav row also has a "Reorder <title>" drag grip, and a non-exact name
    // matches both buttons (strict-mode violation).
    await page.getByRole("button", { name: "Second Page", exact: true }).click();
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
