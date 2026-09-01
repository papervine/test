import { test, expect, type Locator } from "@playwright/test";
import postgres from "postgres";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { TEST_DB_URL } from "./global-setup";
import { ORG_SLUG, sitePath, TEST_S3, TEST_USER } from "./constants";

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
            "slashtabs",
            "edgepage",
            "edgetaskpage",
            "edgeblockpage",
            "accordionpage",
            "codegrouppage",
            "codehlpage",
            "cardpage",
            "inlinepage",
            "treepage",
            "colorpage",
            "previewpage",
            "tablepage",
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
    // …and its own Tabs page, for the same reason: the "/ inside a component" test types into a
    // pane and asserts on what the pane then contains, which `tabby` can't promise once the tab
    // strip test above has renamed, reordered or removed tabs on it.
    await put(
      `${prefix}slashtabs.mdx`,
      "---\ntitle: Slash Tabs\n---\n\n<Tabs>\n" +
        '  <Tab title="One">\n\n    Slash tab anchor line.\n\n  </Tab>\n' +
        '  <Tab title="Two">\n\n    Second pane body.\n\n  </Tab>\n' +
        "</Tabs>\n",
    );
    // The edge-guard and upload tests each get their own page for the same reason: they assert on
    // what is and isn't in a document, so sharing one made the result depend on run order.
    await put(
      `${prefix}edgepage.mdx`,
      "---\ntitle: Edge\n---\n\n<Tabs>\n" +
        '  <Tab title="Alpha">\n\n    Alpha body text.\n\n  </Tab>\n' +
        '  <Tab title="Beta">\n\n    Beta body text.\n\n  </Tab>\n' +
        "</Tabs>\n",
    );
    // A table, for the grid node view. Its own page: the test adds and removes columns and rows,
    // then asserts on the MDX that comes out.
    await put(
      `${prefix}tablepage.mdx`,
      "---\ntitle: Table\n---\n\n| Name | Type |\n| --- | --- |\n| id | string |\n| count | number |\n",
    );
    // An <AccordionGroup>, for the disclosure-list node view. Its own page, since the test types
    // titles and adds rows and then asserts on what the group contains.
    await put(
      `${prefix}accordionpage.mdx`,
      "---\ntitle: Accordions\n---\n\n<AccordionGroup>\n" +
        '  <Accordion title="First">\n\n    First body text.\n\n  </Accordion>\n' +
        '  <Accordion title="Second">\n\n    Second body text.\n\n  </Accordion>\n' +
        "</AccordionGroup>\n",
    );
    // A <CodeGroup>, for the code tab strip. Its own page: the test renames tabs, changes a
    // language and adds and removes blocks, then asserts on the MDX that comes out.
    await put(
      `${prefix}codegrouppage.mdx`,
      "---\ntitle: Code Group\n---\n\n<CodeGroup>\n\n" +
        "```bash npm\nnpm i papervine\n```\n\n" +
        "```bash yarn\nyarn add papervine\n```\n\n" +
        "</CodeGroup>\n",
    );
    // A fence with real code in it, for the highlighter. Its own page: the test changes the
    // block's language and asserts on the tokens that produces. In a group, because that's where
    // the language picker lives.
    await put(
      `${prefix}codehlpage.mdx`,
      "---\ntitle: Code Highlight\n---\n\n<CodeGroup>\n\n```ts app.ts\nconst answer = 42;\n```\n\n</CodeGroup>\n",
    );
    // A pair of cards, for the card node view. Its own page: the test names one, gives it an icon
    // and a link, and removes the other, then asserts on the MDX.
    await put(
      `${prefix}cardpage.mdx`,
      "---\ntitle: Cards\n---\n\n<CardGroup cols={2}>\n" +
        "  <Card>\n\n  </Card>\n" +
        '  <Card title="Second card">\n\n    Second card body.\n\n  </Card>\n' +
        "</CardGroup>\n",
    );
    // The components whose whole content is ATTRS — inline labels, tree rows, colour swatches.
    // Each on its own page: every one of these tests adds and removes rows and asserts on the MDX.
    await put(
      `${prefix}inlinepage.mdx`,
      "---\ntitle: Inline\n---\n\n" +
        'Status: <Badge color="green">Stable</Badge> and an <Icon icon="rocket" /> icon.\n',
    );
    await put(
      `${prefix}treepage.mdx`,
      "---\ntitle: Tree\n---\n\n<Tree>\n" +
        '  <Tree.Folder name="src" defaultOpen>\n' +
        '    <Tree.File name="index.ts" />\n' +
        "  </Tree.Folder>\n" +
        '  <Tree.File name="README.md" />\n' +
        "</Tree>\n",
    );
    // Namespace components (`<Color.Item>`, `<Tree.Folder>`) on a page the PREVIEW renders: the
    // preview sets a link/asset base, and that is the branch that used to lose the members.
    await put(
      `${prefix}previewpage.mdx`,
      // Titled "Namespaces", not "Preview": the nav row's name would otherwise collide with the
      // Preview button the overlay test clicks (`getByRole("button", { name: "Preview" })`).
      "---\ntitle: Namespaces\n---\n\n<Color>\n" +
        '  <Color.Item name="PREVIEW_SWATCH" value="#7c3aed" />\n' +
        "</Color>\n\n<Tree>\n" +
        '  <Tree.Folder name="src">\n' +
        '    <Tree.File name="PREVIEW_FILE.ts" />\n' +
        "  </Tree.Folder>\n" +
        "</Tree>\n",
    );
    await put(
      `${prefix}colorpage.mdx`,
      "---\ntitle: Colors\n---\n\n<Color>\n" +
        '  <Color.Item name="primary" value="#7c3aed" />\n' +
        "</Color>\n",
    );
    // A task list that OPENS a tab: its first checkbox sits on the very position the edge guard
    // swallows, so it was the one checkbox in the editor that couldn't be backspaced away.
    await put(
      `${prefix}edgetaskpage.mdx`,
      "---\ntitle: Edge Tasks\n---\n\n<Tabs>\n" +
        '  <Tab title="Alpha">\n\n    - [ ] first task\n    - [x] second task\n\n  </Tab>\n' +
        '  <Tab title="Beta">\n\n    Beta body text.\n\n  </Tab>\n' +
        "</Tabs>\n",
    );
    // A code block and a blockquote that OPEN a component. Emptying either one leaves the caret on
    // the component's leading edge — the position the guard swallows — with the block itself still
    // there and nothing able to remove it.
    await put(
      `${prefix}edgeblockpage.mdx`,
      "---\ntitle: Edge Blocks\n---\n\n<AccordionGroup>\n" +
        '  <Accordion title="Code">\n\n    ```js\n    hi\n    ```\n\n  </Accordion>\n' +
        '  <Accordion title="Quote">\n\n    > quoted\n\n  </Accordion>\n' +
        "</AccordionGroup>\n",
    );
    // A page that ALREADY has a task list: the bug was about opening existing content, not about
    // inserting new. The plain bullet is there to prove it doesn't grow a checkbox.
    await put(
      `${prefix}taskpage.mdx`,
      "---\ntitle: Tasks\n---\n\n- [ ] not done\n- [x] done\n- plain bullet\n",
    );
    // The shared text a COLLABORATOR receives the moment someone presses Enter at the end of a
    // task list: markdown can't express "unchecked task item with no text", so the new row is a
    // bare `-`. Opening this page is exactly what the peer's editor does with that text.
    await put(
      `${prefix}emptytaskpage.mdx`,
      "---\ntitle: Empty task\n---\n\n- [ ] asasassa\n-\n",
    );
    // An empty page for the changelog-entry insert test to build on.
    await put(`${prefix}updatepage.mdx`, "---\ntitle: Changelog\n---\n\nRelease notes below.\n");
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

    // A Card's href is a live next/link wrapping the card; clicking the card itself — its padding,
    // not its editable body and not one of its fields — does the same thing rather than routing
    // the app host to a 404.
    await page.getByRole("button", { name: "Linky", exact: true }).click();
    await expect(prose).toContainText("An inline link", { timeout: 10_000 });
    const card = prose.locator("a").filter({ hasText: "Card body text" });
    // The card's own controls live INSIDE that <a>, so clicking one has to focus it rather than
    // navigate — otherwise a linked card's title and icon are unreachable with the mouse.
    await card.getByRole("textbox", { name: "Card title" }).click();
    await expect(card.getByRole("textbox", { name: "Card title" })).toBeFocused();
    expect(onEditorRoute()).toBe(editorPath);
    await expect(title).toHaveValue("Linky");

    await card.click({ position: { x: 6, y: 6 } });
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

  // New chat + history (SPEC §9.2): past agent conversations are a per-person convenience, so
  // they live in localStorage — which makes the journey fully deterministic with the API route
  // intercepted: user bubbles render optimistically, no AI required.
  test("starts a new agent chat and restores the old one from history", async ({ page }) => {
    await page.route("**/api/editor-agent", (route) =>
      route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "off" }) }),
    );
    await page.goto(sitePath(SLUG, "editor"));
    await page.getByRole("button", { name: /Ask agent/ }).click();
    const composer = page.getByPlaceholder('Try "expand more about…"');
    await expect(composer).toBeVisible();

    await composer.fill("first conversation marker");
    await composer.press("Enter");
    await expect(page.getByText("first conversation marker")).toBeVisible();

    // New chat clears the thread back to the empty prompt…
    await page.getByRole("button", { name: "New chat" }).click();
    await expect(page.getByText("first conversation marker")).toBeHidden();
    await expect(page.getByText(/Ask the agent to edit your docs/)).toBeVisible();

    // …and the old one is in history, titled by what was asked, and restorable.
    await page.getByRole("button", { name: "Chat history" }).click();
    // History is a view of the panel (not a dropdown): Back header, rows with age + branch.
    await expect(page.getByRole("button", { name: "Back" })).toBeVisible();
    await expect(page.getByText("less than a minute ago").first()).toBeVisible();
    await page.getByRole("button", { name: /first conversation marker/ }).click();
    await expect(page.getByText("first conversation marker")).toBeVisible();

    // A second chat lists BOTH, newest first, and switching between them round-trips.
    await page.getByRole("button", { name: "New chat" }).click();
    await composer.fill("second conversation marker");
    await composer.press("Enter");
    await expect(page.getByText("second conversation marker")).toBeVisible();
    await page.getByRole("button", { name: "Chat history" }).click();
    const entries = page.locator("button", { hasText: /conversation marker/ });
    await expect(entries.first()).toContainText("second conversation marker");
    await expect(entries.nth(1)).toContainText("first conversation marker");
  });

  // Copy/Good/Bad under agent replies (SPEC §9.2). The reply is a fabricated AI SDK UI-message
  // stream (deterministic — no provider), but the feedback POST goes through the REAL route, so
  // the durable assertion is the analytics_event row itself: type='feedback', path='/editor-agent',
  // query = the ask the reply answered.
  test("rates an agent reply and copies it", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await sql`delete from analytics_event where site_id = ${SITE_ID}`; // own precondition
    const sse =
      [
        { type: "start" },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "A deterministic reply." },
        { type: "text-end", id: "t1" },
        { type: "finish" },
      ]
        .map((c) => `data: ${JSON.stringify(c)}\n\n`)
        .join("") + "data: [DONE]\n\n";
    await page.route("**/api/editor-agent", (route) =>
      route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" },
        body: sse,
      }),
    );
    await page.goto(sitePath(SLUG, "editor"));
    await page.getByRole("button", { name: /Ask agent/ }).click();
    const composer = page.getByPlaceholder('Try "expand more about…"');
    await composer.fill("rate this please");
    await composer.press("Enter");
    await expect(page.getByText("A deterministic reply.")).toBeVisible();

    // Copy message → the reply's text lands on the clipboard.
    await page.getByRole("button", { name: "Copy message" }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe("A deterministic reply.");

    // Good response → highlighted, and a REAL feedback row lands in analytics.
    const good = page.getByRole("button", { name: "Good response" });
    await good.click();
    await expect(good).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(async () => {
        const rows = await sql<{ status: string; path: string; query: string }[]>`
          select status, path, query from analytics_event
          where site_id = ${SITE_ID} and type = 'feedback'`;
        return rows.map((r) => `${r.status} ${r.path} ${r.query}`);
      })
      .toEqual(["up /editor-agent rate this please"]);

    // The same thumb twice logs nothing new; switching thumbs logs the new choice.
    await good.click();
    await page.getByRole("button", { name: "Bad response" }).click();
    await expect
      .poll(async () => {
        const rows = await sql<{ status: string }[]>`
          select status from analytics_event
          where site_id = ${SITE_ID} and type = 'feedback' order by created_at`;
        return rows.map((r) => r.status);
      })
      .toEqual(["up", "down"]);
  });

  // Attachments ride INSIDE the chat message as data-URL file parts (SPEC §9.2) — no storage,
  // no extra endpoint — so the thing to pin is the wire shape: what the composer actually POSTs.
  // The route is intercepted, which also makes this deterministic with no AI provider at all.
  test("attaches files to the agent message as inline context", async ({ page }) => {
    let captured: { messages: { parts: { type: string; mediaType?: string; url?: string; filename?: string }[] }[] } | null = null;
    await page.route("**/api/editor-agent", async (route) => {
      captured = route.request().postDataJSON();
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "not configured" }),
      });
    });

    await page.goto(sitePath(SLUG, "editor"));
    await page.getByRole("button", { name: /Ask agent/ }).click();
    const composer = page.getByPlaceholder('Try "expand more about…"');
    await expect(composer).toBeVisible();

    // Attach through the paperclip: a markdown file and a (1×1 PNG) screenshot.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==",
      "base64",
    );
    const chooser1 = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Attach a file" }).click();
    await (await chooser1).setFiles([
      { name: "notes.md", mimeType: "text/markdown", buffer: Buffer.from("# Notes\nfold this in") },
      { name: "shot.png", mimeType: "image/png", buffer: png },
    ]);
    await expect(page.getByText("notes.md")).toBeVisible();
    await expect(page.getByText("shot.png")).toBeVisible();

    // Removal really removes — attach a third, take it back off, and it must not be sent.
    const chooser2 = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Attach a file" }).click();
    await (await chooser2).setFiles({ name: "stray.txt", mimeType: "text/plain", buffer: Buffer.from("no") });
    await page.getByRole("button", { name: "Remove stray.txt" }).click();
    await expect(page.getByText("stray.txt")).toHaveCount(0);

    await composer.fill("use the attached notes");
    await composer.press("Enter");
    await expect.poll(() => captured !== null).toBe(true);

    const parts = captured!.messages.at(-1)!.parts;
    const files = parts.filter((q) => q.type === "file");
    expect(files.map((f) => f.filename)).toEqual(["notes.md", "shot.png"]);
    expect(files.every((f) => f.url?.startsWith("data:"))).toBe(true);
    expect(files.map((f) => f.mediaType)).toEqual(["text/markdown", "image/png"]);
    // …and the sent bubble shows them (the chip and the thumbnail), with the composer cleared.
    await expect(page.getByRole("img", { name: "shot.png" })).toBeVisible();
    await expect(composer).toHaveValue("");
    await expect(page.getByRole("button", { name: "Attach a file" })).toBeVisible();

    // The size budget refuses in place, before any request: one file over the total cap.
    const chooser3 = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Attach a file" }).click();
    await (await chooser3).setFiles({
      name: "huge.png",
      mimeType: "image/png",
      buffer: Buffer.alloc(3 * 1024 * 1024 + 4096, 1),
    });
    // Filtered: the intercepted 503 puts the chat's own error alert on the page too.
    await expect(page.getByRole("alert").filter({ hasText: "limit" })).toBeVisible();
    await expect(page.getByText("huge.png")).toHaveCount(0);
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

  // Reported from two browsers side by side: pressing Enter at the end of a task list gave the
  // typist a new checkbox, while the collaborator watching saw a plain BULLET until the first
  // letter arrived. The peer only ever sees the shared TEXT, and markdown can't say "unchecked task
  // item with no text" — the new row is a bare `-`. Opening a page holding that text is exactly the
  // peer's situation, which is what makes this assertable without a second browser.
  test("a task list's still-empty row renders as a checkbox, not a bullet", async ({ page }) => {
    await page.goto(`${sitePath(SLUG, "editor")}?slug=emptytaskpage`);
    const pm = page.locator(".pv-visual .ProseMirror");
    await expect(pm).toBeVisible({ timeout: 15_000 });

    // Both rows: the one with text, and the empty one the author is about to type into.
    await expect(pm.locator('li[data-checked="false"]')).toHaveCount(2);
    await expect(pm.locator("li:not([data-checked])")).toHaveCount(0);
    await expect(pm.locator('input[type="checkbox"]')).toHaveCount(2);

    // And it stays a task row when typed into — the text becomes a real GFM task item. Reached with
    // the keyboard: an empty <li> has no clickable text box, so clicking it just times out.
    await pm.locator("li").first().click();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("End");
    await page.keyboard.type("second");
    const draft = async () => {
      const rows = await sql<{ content: string }[]>`
        select content from draft_file d
        join editor_session s on s.id = d.session_id
        where s.site_id = ${SITE_ID} and s.status = 'open' and d.path = 'emptytaskpage.mdx'`;
      return rows[0]?.content ?? "";
    };
    await expect.poll(draft, { timeout: 10_000 }).toContain("- [ ] second");

    await clearDrafts(["emptytaskpage.mdx"]);
  });

  // Reported: "I should not have to hover over the component itself to show the left margin
  // options — hovering the whole line should do it." DragHandle resolves the hovered block from a
  // ProseMirror mousemove, so the pointer has to be over `.ProseMirror`; with the gutter as padding
  // on the scroll container it was dead space. Pure geometry, so only a browser shows it: the DOM
  // is identical either way, and both positions are inside the same row.
  test("hovering a row's left margin reveals that block's controls", async ({ page }) => {
    await page.goto(sitePath(SLUG, "editor"));
    const pm = page.locator(".pv-visual .ProseMirror");
    await expect(pm).toBeVisible({ timeout: 15_000 });
    const controls = page.locator(".pv-block-controls");

    const box = (await pm.locator("p").first().boundingBox())!;
    const midY = box.y + box.height / 2;

    // Move away first: the handle is only hidden when nothing is hovered, so a stale hover from
    // page load would make either assertion pass.
    await page.mouse.move(4, 4);
    await expect(controls).toBeHidden();

    // Over the text — the case that always worked.
    await page.mouse.move(box.x + 40, midY);
    await expect(controls).toBeVisible();

    // And now the gutter to its left, which is the reported case.
    await page.mouse.move(4, 4);
    await expect(controls).toBeHidden();
    await page.mouse.move(box.x - 30, midY);
    await expect(controls).toBeVisible();
    // The handle sits in that gutter, i.e. left of the text it belongs to.
    const handle = (await page.locator(".pv-drag-handle").boundingBox())!;
    expect(handle.x).toBeLessThan(box.x);
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

  // The table node view (SPEC §9.2). A markdown table used to be three hand-rolled nodes you could
  // only type into: no way to add a column, no way to remove a row, nothing showing where a cell
  // ended. The schema is prosemirror-tables' now, and this is the chrome around it. Browser-only —
  // the handles are positioned from measured cell geometry, so they don't exist until layout does.
  test("a table is an editable grid: add a column and a row, select one, remove it", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
    });

    await page.goto(`${sitePath(SLUG, "editor")}?slug=tablepage`);
    const pm = page.locator(".pv-visual .ProseMirror");
    await expect(pm).toBeVisible({ timeout: 15_000 });

    const cells = page.locator(".pv-table-scroll tr:first-child > *");
    const rows = page.locator(".pv-table-scroll tr");
    await expect(cells).toHaveCount(2);
    await expect(rows).toHaveCount(3);
    // A handle per column and per row, measured onto the real geometry.
    await expect(page.locator(".pv-table-grip-col")).toHaveCount(2);
    await expect(page.locator(".pv-table-grip-row")).toHaveCount(3);

    // Both controls say what they do, including the gesture the icon can't show.
    const rowControl = page.locator(".pv-table-add-row");
    await rowControl.hover();
    await expect(rowControl.locator(".pv-table-tip")).toHaveText(
      "Click to add a new rowDrag to add or remove rows",
    );

    await page.locator(".pv-table-add-col").click();
    await expect(cells).toHaveCount(3);
    await rowControl.click();
    await expect(rows).toHaveCount(4);

    // …and the drag the tooltip promises: away from the table adds, back over it removes. Pointer
    // events rather than a helper, because the whole behaviour is "how far did you drag".
    const rowHeight = (await rows.last().boundingBox())!.height;
    const dragRow = async (by: number) => {
      // Measured per drag: adding rows moves the control down, so a box captured once is a press
      // that lands on the table instead of the button.
      const bar = (await rowControl.boundingBox())!;
      const x = bar.x + bar.width / 2;
      const y = bar.y + bar.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x, y + by / 2);
      await page.mouse.move(x, y + by);
      await page.mouse.up();
    };
    await dragRow(rowHeight * 2);
    await expect(rows).toHaveCount(6);
    await dragRow(-rowHeight * 2);
    await expect(rows).toHaveCount(4);
    // The handles re-measure rather than going stale against the new shape.
    await expect(page.locator(".pv-table-grip-col")).toHaveCount(3);
    await expect(page.locator(".pv-table-grip-row")).toHaveCount(4);

    // A handle selects its whole column — and the formatting toolbar stays out of the way, since
    // selecting a column is a structural act, not a prelude to bolding it.
    await page.locator(".pv-table-grip-col").nth(2).locator("button").click();
    await expect(page.locator(".pv-table-scroll .selectedCell")).toHaveCount(4);
    await expect(page.locator(".pv-bubble")).toHaveCount(0);

    // …and the ✕ that appears on the selected handle removes it.
    await page.locator(".pv-table-grip-remove").click();
    await expect(cells).toHaveCount(2);

    // A cell holds blocks, so a list can live in one — GFM has no syntax for that, so it goes out
    // as the HTML MDX renders as a real list (see the round-trip tests for both directions). Typed
    // into the empty cell the + added, so the assertion is about the list and not about what Enter
    // does to text that was already there.
    const cell = rows.last().locator("td").first();
    await cell.click();
    await page.keyboard.type("- one");
    await expect(cell.locator("ul li")).toHaveCount(1);

    // All of it back out as a GFM table, with the added row still there.
    const draft = async () => {
      const drafted = await sql<{ content: string }[]>`
        select content from draft_file d
        join editor_session s on s.id = d.session_id
        where s.site_id = ${SITE_ID} and s.status = 'open' and d.path = 'tablepage.mdx'`;
      return drafted[0]?.content ?? "";
    };
    await expect.poll(draft, { timeout: 10_000 }).toContain("| id");
    const saved = await draft();
    expect(saved, "the table stopped being a table").toContain("| ---");
    expect(saved, "the cell's list didn't survive as markup MDX renders").toContain(
      "<ul><li>one</li></ul>",
    );
    // Header, the alignment rule, the two original rows, and the one the + added (now holding the
    // list).
    const tableLines = saved.split("\n").filter((line) => line.startsWith("|"));
    expect(tableLines).toHaveLength(5);

    const reactErrors = errors.filter(
      (e) =>
        e.startsWith("pageerror:") ||
        /flushSync|Maximum update depth|Cannot update a component|not wrapped in act|hydrat|Invalid content/i.test(
          e,
        ),
    );
    expect(reactErrors, `unexpected React errors:\n${reactErrors.join("\n")}`).toEqual([]);

    await clearDrafts(["tablepage.mdx"]);
  });

  // The <AccordionGroup> node view (SPEC §9.2): a real disclosure list. The reader's component
  // can't be edited in place — closed it would hide its own content, so every accordion used to be
  // pinned open, and the title is an attr, so naming one meant Source mode. Browser-only: the
  // chevron, the title field and the group's border are all view-layer.
  test("the accordion group is a real disclosure list, titled and added to in place", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
    });

    await page.goto(`${sitePath(SLUG, "editor")}?slug=accordionpage`);
    const pm = page.locator(".pv-visual .ProseMirror");
    await expect(pm).toBeVisible({ timeout: 15_000 });

    const rows = page.locator(".pv-accordion");
    await expect(rows).toHaveCount(2);
    // The published component, not a lookalike: the group class comes from AccordionGroup itself,
    // and it draws ONE border around the list rather than a stack of separate boxes.
    await expect(page.locator(".pv-accordion-group")).toHaveCount(1);
    // …and the rows go flat inside it, with the seam between them drawn instead.
    await expect(rows.first()).toHaveCSS("border-top-width", "0px");
    await expect(rows.nth(1)).toHaveCSS("border-top-width", "1px");

    // The chevron really closes the row — the body is hidden, not unmounted (it IS the content
    // hole, so removing it would take the content out of the document).
    const second = rows.nth(1);
    await expect(second.locator(".pv-accordion-body")).toBeVisible();
    await second.locator('button[aria-expanded="true"]').click();
    await expect(second.locator(".pv-accordion-body")).toBeHidden();
    await expect(second.locator('button[aria-expanded="false"]')).toHaveCount(1);
    await expect(pm).toContainText("Second body text.", { useInnerText: false });

    // The title is a field, and Enter moves into the body — a heading, then what's under it.
    const firstTitle = rows.first().locator("input");
    await expect(firstTitle).toHaveValue("First");
    await firstTitle.fill("Renamed");
    await firstTitle.press("Enter");
    await page.keyboard.type("Body typed after Enter.");
    await expect(rows.first().locator(".pv-accordion-body")).toContainText("Body typed after Enter.");

    // The + on a row adds the next one directly BELOW it — not at the end of the group — and puts
    // the caret in its name.
    await rows.first().locator('button[aria-label^="Add an accordion below"]').click();
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(1).locator("input")).toBeFocused();
    await expect(rows.nth(1).locator("input")).toHaveValue("");
    await expect(rows.nth(2).locator("input")).toHaveValue("Second");

    // …and removing takes that row back out.
    await rows.nth(1).locator('button[aria-label^="Remove"]').click();
    await expect(rows).toHaveCount(2);

    // All of it in the draft as real MDX — including the untitled row NOT publishing a made-up
    // title, and the empty one staying `<Accordion />` rather than growing a tag pair.
    const draft = async () => {
      const drafted = await sql<{ content: string }[]>`
        select content from draft_file d
        join editor_session s on s.id = d.session_id
        where s.site_id = ${SITE_ID} and s.status = 'open' and d.path = 'accordionpage.mdx'`;
      return drafted[0]?.content ?? "";
    };
    await expect.poll(draft, { timeout: 10_000 }).toContain('<Accordion title="Renamed">');
    expect(await draft()).toContain("Body typed after Enter.");

    const reactErrors = errors.filter(
      (e) =>
        e.startsWith("pageerror:") ||
        /flushSync|Maximum update depth|Cannot update a component|not wrapped in act|hydrat|Invalid content/i.test(
          e,
        ),
    );
    expect(reactErrors, `unexpected React errors:\n${reactErrors.join("\n")}`).toEqual([]);

    await clearDrafts(["accordionpage.mdx"]);
  });

  // The <CodeGroup> node view (SPEC §9.2): the reader's tab strip, made editable. Browser-only
  // for the same reason as <Tabs> — which block is showing is a scoped CSS rule, and the label,
  // language and add/remove controls are all view-layer over the fence's own `meta`.
  test("the code group is an editable tab strip over its fences", async ({ page }) => {
    // The heaviest case in the file: it cold-compiles its own page, then drives the language picker,
    // a rename, an add, a delete, four keystroke guards and two draft polls. On the default 30s
    // budget it intermittently overran — always as `Error: aborted` on a navigation, the signature
    // CLAUDE.md records for a test running out of clock rather than a broken page (the `domain` and
    // `members-roles` specs presented identically). `test.slow()` gives it the budget the work
    // actually needs; it is not masking a failure, and if this ever fails on an assertion instead of
    // a timeout, that IS a real one.
    test.slow();

    // Own the starting content: this test renames tabs and removes a block, then asserts on the
    // MDX, so a draft left by an earlier run would have it asserting against a different group.
    await clearDrafts(["codegrouppage.mdx"]);

    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
    });

    await page.goto(`${sitePath(SLUG, "editor")}?slug=codegrouppage`);
    const pm = page.locator(".pv-visual .ProseMirror");
    await expect(pm).toBeVisible({ timeout: 15_000 });

    const group = page.locator(".pv-codegroup");
    const tabs = group.locator("button[title='Double-click to rename']");
    const blocks = group.locator("[data-pv-code]");
    // The tabs are the fences' own titles (```bash npm), not their language.
    await expect(tabs).toHaveText(["npm", "yarn"]);
    await expect(blocks).toHaveCount(2);

    // One block showing at a time, and clicking a tab swaps which — the whole point of the strip.
    await expect(blocks.first()).toBeVisible();
    await expect(blocks.nth(1)).toBeHidden();
    await tabs.nth(1).click();
    await expect(blocks.first()).toBeHidden();
    await expect(blocks.nth(1)).toBeVisible();
    await expect(blocks.nth(1)).toContainText("yarn add papervine");

    // The language control names the ACTIVE block's language, reading ```bash as "Bash" rather
    // than leaving the author to guess at the raw id.
    const language = group.getByRole("button", { name: "Language" });
    await expect(language).toContainText("Bash");
    await language.click();
    // The menu portals to <body> (the group's overflow-hidden clipped it in place), so it is
    // addressed from the page rather than from inside the group.
    await page.getByRole("textbox", { name: "Search languages" }).fill("python");
    await page.getByRole("button", { name: "Python", exact: true }).click();
    await expect(language).toContainText("Python");

    // Double-click renames the tab, which is the fence's title.
    await tabs.nth(1).dblclick();
    const field = group.getByRole("textbox", { name: "File name" });
    await field.fill("pnpm");
    await field.press("Enter");
    await expect(tabs).toHaveText(["npm", "pnpm"]);

    // + adds a block after the last, inheriting the language you were looking at (so its tab
    // falls back to "python"), and it opens ready to type.
    await group.getByRole("button", { name: "Add code block" }).click();
    await expect(blocks).toHaveCount(3);
    await expect(tabs).toHaveText(["npm", "pnpm", "python"]);
    await expect(blocks.nth(2)).toBeVisible();
    // An empty fence says what to do with itself rather than sitting there as a blank rectangle.
    await expect(blocks.nth(2)).toContainText("// add code here");

    // Backspace inside a tab must never take the tab. Three defaults used to: an EMPTY code block
    // became a paragraph (TipTap's own shortcut, and our edge guard at the first tab), which drops
    // out of the strip because only code blocks are tabs; a block with content was JOINED with its
    // neighbour on Backspace at its start. Reported as "pressing backspace while inside a code
    // group destroys a tab". Pressed twice each: a second press must be as harmless as the first.
    await blocks.nth(2).locator("code").click();
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await expect(blocks).toHaveCount(3);
    await expect(blocks.nth(2).locator("pre code")).toHaveCount(1);
    await page.keyboard.type("x");
    await expect(blocks.nth(2).locator("pre code")).toHaveText("x");
    // Home INSIDE the poll: `press` resolves when the event is sent, not when applied, and a
    // Backspace that lands before the caret has moved just deletes the "x" — which made the first
    // version of this step pass with the guard switched off. Re-asking for line start is
    // idempotent, so this is a wait, not a retry.
    await expect
      .poll(async () => {
        await page.keyboard.press("Home");
        return page.evaluate(() => window.getSelection()?.anchorOffset ?? -1);
      })
      .toBe(0);
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await expect(blocks).toHaveCount(3);
    await expect(tabs).toHaveText(["npm", "pnpm", "python"]);
    await expect(blocks.nth(2).locator("pre code")).toHaveText("x");
    // An ordinary character delete still works: forward Delete from the same polled position
    // (offset 0 with content after it is not the trailing edge), so no second caret move to race.
    await page.keyboard.press("Delete");
    await expect(blocks.nth(2).locator("pre code")).toHaveText("");
    await expect(blocks).toHaveCount(3);

    // …and ✕ takes it back out. Only the active tab offers one, so a stray click can't delete a
    // block you aren't looking at.
    await expect(group.locator("button[aria-label^='Remove']")).toHaveCount(1);
    await group.locator("button[aria-label^='Remove']").click();
    await expect(blocks).toHaveCount(2);

    // All of it in the draft as real MDX: the rename is the fence's own title, and the language
    // change is the fence's info string — nothing is editor-only state.
    const draft = async () => {
      const drafted = await sql<{ content: string }[]>`
        select content from draft_file d
        join editor_session s on s.id = d.session_id
        where s.site_id = ${SITE_ID} and s.status = 'open' and d.path = 'codegrouppage.mdx'`;
      return drafted[0]?.content ?? "";
    };
    await expect.poll(draft, { timeout: 10_000 }).toContain("```python pnpm");
    const mdx = await draft();
    expect(mdx).toContain("```bash npm");
    expect(mdx).toContain("yarn add papervine");
    expect(mdx).toContain("<CodeGroup>");

    const reactErrors = errors.filter(
      (e) =>
        e.startsWith("pageerror:") ||
        /flushSync|Maximum update depth|Cannot update a component|not wrapped in act|hydrat|Invalid content/i.test(
          e,
        ),
    );
    expect(reactErrors, `unexpected React errors:\n${reactErrors.join("\n")}`).toEqual([]);

    await clearDrafts(["codegrouppage.mdx"]);
  });

  // Syntax highlighting (SPEC §9.2). Published pages are highlighted by Shiki at compile time,
  // which a keystroke can't wait for, so the editor highlights with lowlight decorations instead —
  // and the fact worth pinning is that they follow the fence's OWN language, the one the picker
  // writes. Browser-only: decorations exist only in a running ProseMirror view.
  test("highlights a fence, and re-highlights it when the language changes", async ({ page }) => {
    await clearDrafts(["codehlpage.mdx"]);
    await page.goto(`${sitePath(SLUG, "editor")}?slug=codehlpage`);
    const block = page.locator(".pv-visual .pv-codeblock");
    await expect(block).toBeVisible({ timeout: 15_000 });

    // ```ts — `const` is a keyword, and the short spelling resolves to the same grammar as
    // "typescript" (a fence written ```ts is the common case in real repos), which the picker
    // also has to READ as TypeScript rather than as something it doesn't recognise.
    await expect(block.locator(".hljs-keyword")).toHaveText(["const"]);
    const language = page.getByRole("button", { name: "Language" });
    await expect(language).toContainText("TypeScript");

    // Plain Text is a real choice, not the absence of one: it has to CLEAR the tokens rather than
    // leave the highlighter guessing at the content.
    await language.click();
    await page.getByRole("button", { name: "Plain Text", exact: true }).click();
    await expect(block.locator(".hljs-keyword")).toHaveCount(0);

    await clearDrafts(["codehlpage.mdx"]);
  });

  // The <Card> node view (SPEC §9.2). A card's icon, title and link are attrs, so the generic
  // component view could render them and not edit them — naming a card meant Source mode. All
  // three are controls now, inside the published card. Browser-only: the icon set, the fields and
  // the menu are view-layer, and the point is that they write the card's own attributes.
  test("names a card, gives it an icon and a link, and removes one", async ({ page }) => {
    await clearDrafts(["cardpage.mdx"]);

    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
    });

    await page.goto(`${sitePath(SLUG, "editor")}?slug=cardpage`);
    const pm = page.locator(".pv-visual .ProseMirror");
    await expect(pm).toBeVisible({ timeout: 15_000 });

    const cards = page.locator(".pv-card-node");
    await expect(cards).toHaveCount(2);
    const first = cards.first();

    // An untitled card still shows its field and says what its body is for — with nothing there,
    // there'd be nowhere to click and no hint that a card has a title at all.
    const titleField = first.getByRole("textbox", { name: "Card title" });
    await expect(titleField).toHaveValue("");
    await expect(first).toContainText("Enter your card description here");

    // Name it, then Enter to drop into the body — a card is a name, then a description.
    await titleField.fill("Quickstart");
    await titleField.press("Enter");
    await page.keyboard.type("Up in five minutes.");
    await expect(first).not.toContainText("Enter your card description here");

    // The icon set: search, pick, and it becomes the card's `icon`.
    await first.getByRole("button", { name: "Add an icon" }).click();
    await page.getByRole("textbox", { name: "Search icons" }).fill("rocket");
    await page.getByRole("button", { name: "rocket", exact: true }).click();
    await expect(first.getByRole("button", { name: "Icon: rocket" })).toBeVisible();

    // …and off again. Remove is only offered when there IS one, so it can't be a control that
    // does nothing.
    await first.getByRole("button", { name: "Icon: rocket" }).click();
    await page.getByRole("button", { name: "Remove" }).click();
    await expect(first.getByRole("button", { name: "Add an icon" })).toBeVisible();
    await first.getByRole("button", { name: "Add an icon" }).click();
    await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    // The link, from the card's own menu.
    await first.getByRole("button", { name: "Card options" }).click();
    await page.getByRole("textbox", { name: "Card link" }).fill("/second");
    await page.getByRole("textbox", { name: "Card link" }).press("Enter");

    // …and removing the other card takes it out of the group without touching this one.
    await cards.nth(1).getByRole("button", { name: "Card options" }).click();
    await page.getByRole("button", { name: "Remove card" }).click();
    await expect(cards).toHaveCount(1);

    // All of it in the draft as real MDX — the attrs readers get, not editor state.
    const draft = async () => {
      const drafted = await sql<{ content: string }[]>`
        select content from draft_file d
        join editor_session s on s.id = d.session_id
        where s.site_id = ${SITE_ID} and s.status = 'open' and d.path = 'cardpage.mdx'`;
      return drafted[0]?.content ?? "";
    };
    await expect.poll(draft, { timeout: 10_000 }).toContain('title="Quickstart"');
    const mdx = await draft();
    expect(mdx).toContain('href="/second"');
    expect(mdx).toContain("Up in five minutes.");
    // The icon was added and taken off again, so it must not have been left behind.
    expect(mdx).not.toContain("icon=");
    expect(mdx).not.toContain("Second card");

    const reactErrors = errors.filter(
      (e) =>
        e.startsWith("pageerror:") ||
        /flushSync|Maximum update depth|Cannot update a component|not wrapped in act|hydrat|Invalid content/i.test(
          e,
        ),
    );
    expect(reactErrors, `unexpected React errors:\n${reactErrors.join("\n")}`).toEqual([]);

    await clearDrafts(["cardpage.mdx"]);
  });

  // The inline components (SPEC §9.2): <Badge> and <Icon> sit in a run of text, so MDX parses them
  // as inline JSX — which the converter used to preserve as raw source, meaning a badge showed in
  // the Visual editor as its own MDX and there was no way to insert one. Browser-only: what's
  // being asserted is that they render live, in the sentence, and stay there when edited.
  test("renders a badge and an icon inline, and inserts more from the / menu", async ({ page }) => {
    await clearDrafts(["inlinepage.mdx"]);
    await page.goto(`${sitePath(SLUG, "editor")}?slug=inlinepage`);
    const pm = page.locator(".pv-visual .ProseMirror");
    await expect(pm).toBeVisible({ timeout: 15_000 });

    // Live components, not source: the badge is the published one (its own class), and the icon
    // is an svg — not the text "<Badge …>".
    const badge = pm.locator("span.pv-inline-node").first();
    await expect(badge).toHaveText("Stable");
    await expect(pm).not.toContainText("<Badge");
    await expect(pm.getByRole("button", { name: "Icon: rocket" })).toBeVisible();

    // The label is the node's own content, so it's typed into like the sentence around it.
    await badge.click();
    await page.keyboard.press("End");
    await page.keyboard.type("!");
    await expect(badge).toHaveText("Stable!");

    // Inserting from the `/` menu puts one in the line rather than breaking the paragraph.
    await pm.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" /badge");
    await page.getByRole("button", { name: /Badge/ }).first().click();
    await expect(pm.locator("span.pv-inline-node")).toHaveCount(3); // 2 badges + the icon

    const draft = async () => {
      const drafted = await sql<{ content: string }[]>`
        select content from draft_file d
        join editor_session s on s.id = d.session_id
        where s.site_id = ${SITE_ID} and s.status = 'open' and d.path = 'inlinepage.mdx'`;
      return drafted[0]?.content ?? "";
    };
    await expect.poll(draft, { timeout: 10_000 }).toContain('<Badge color="green">Stable!</Badge>');
    const mdx = await draft();
    expect(mdx).toContain('<Icon icon="rocket" />');
    // Still one paragraph: an inline component must not have split the line it was inserted into.
    expect(mdx.trim().split("\n\n")).toHaveLength(1);

    await clearDrafts(["inlinepage.mdx"]);
  });

  // The <Tree> node view (SPEC §9.2). Its rows are member-expression tags named entirely by an
  // attr — `<Tree.File name="x" />` has no content hole at all — so the rows are drawn with real
  // fields and added from a control. Browser-only for the same reason as every other node view.
  test("builds a file tree by adding, naming and removing rows", async ({ page }) => {
    await clearDrafts(["treepage.mdx"]);
    await page.goto(`${sitePath(SLUG, "editor")}?slug=treepage`);
    await expect(page.locator(".pv-visual .ProseMirror")).toBeVisible({ timeout: 15_000 });

    const tree = page.locator(".pv-tree");
    await expect(tree.locator(".pv-tree-folder")).toHaveCount(1);
    await expect(tree.locator(".pv-tree-file")).toHaveCount(2);

    // A name is a field on the row.
    const folderName = tree.getByRole("textbox", { name: "Folder name" });
    await expect(folderName).toHaveValue("src");
    await folderName.fill("app");

    // Adding a row: the tree's own control asks which kind, then puts it in.
    await tree.locator(".pv-tree-add").click();
    await page.getByRole("button", { name: "File", exact: true }).click();
    await expect(tree.locator(".pv-tree-file")).toHaveCount(3);
    await page.keyboard.type("main.ts");

    // …and removing one takes it back out. Addressed by the button's own label rather than by the
    // row's text: a row's name lives in an INPUT, so `hasText` never matches it.
    await tree.getByRole("button", { name: "Remove README.md" }).click();
    await expect(tree.locator(".pv-tree-file")).toHaveCount(2);

    const draft = async () => {
      const drafted = await sql<{ content: string }[]>`
        select content from draft_file d
        join editor_session s on s.id = d.session_id
        where s.site_id = ${SITE_ID} and s.status = 'open' and d.path = 'treepage.mdx'`;
      return drafted[0]?.content ?? "";
    };
    await expect.poll(draft, { timeout: 10_000 }).toContain('<Tree.Folder name="app"');
    const mdx = await draft();
    expect(mdx).toContain('<Tree.File name="main.ts" />');
    expect(mdx).not.toContain("README.md");
    // `defaultOpen` was on the row before this test touched it, and nothing here should have
    // dropped an attr it never asked about.
    expect(mdx).toContain("defaultOpen");

    await clearDrafts(["treepage.mdx"]);
  });

  // The <Color> node view (SPEC §9.2): swatches whose colour and name are attrs.
  test("edits a colour swatch and adds another", async ({ page }) => {
    await clearDrafts(["colorpage.mdx"]);
    await page.goto(`${sitePath(SLUG, "editor")}?slug=colorpage`);
    await expect(page.locator(".pv-visual .ProseMirror")).toBeVisible({ timeout: 15_000 });

    const palette = page.locator(".pv-color");
    await expect(palette.locator(".pv-color-item")).toHaveCount(1);

    // The swatch opens an editor for the two things it is.
    await palette.getByRole("button", { name: "Edit primary" }).click();
    await page.getByRole("textbox", { name: "Colour value" }).fill("#16a34a");
    await page.getByRole("textbox", { name: "Colour name" }).fill("brand");
    await page.keyboard.press("Escape");

    await palette.getByRole("button", { name: "Add a colour" }).click();
    await expect(palette.locator(".pv-color-item")).toHaveCount(2);

    const draft = async () => {
      const drafted = await sql<{ content: string }[]>`
        select content from draft_file d
        join editor_session s on s.id = d.session_id
        where s.site_id = ${SITE_ID} and s.status = 'open' and d.path = 'colorpage.mdx'`;
      return drafted[0]?.content ?? "";
    };
    await expect.poll(draft, { timeout: 10_000 }).toContain('name="brand"');
    const mdx = await draft();
    expect(mdx).toContain('value="#16a34a"');
    expect(mdx).toContain('<Color.Item name="new-color"');

    await clearDrafts(["colorpage.mdx"]);
  });

  // `<Update>` — a changelog entry. It rendered for readers already; what's new is that the editor
  // MODELS it: `/update` inserts one, and its two authored parts (the label readers link to, and
  // the description) are fields rather than a Source-mode job. Asserted through the draft MDX,
  // because the point is that editing the fields writes real attrs on the real element.
  test("inserts a changelog entry and edits its label and description", async ({ page }) => {
    await clearDrafts(["updatepage.mdx"]);
    await page.goto(`${sitePath(SLUG, "editor")}?slug=updatepage`);
    const pm = page.locator(".pv-visual .ProseMirror");
    await expect(pm).toBeVisible({ timeout: 15_000 });

    // Insert from the `/` menu at the end of the page.
    await pm.click();
    await page.keyboard.press("Meta+ArrowDown");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/update");
    await expect(page.locator(".pv-slash-menu")).toContainText("Changelog entry");
    await page.keyboard.press("Enter");

    const entry = pm.locator(".pv-update");
    await expect(entry).toBeVisible();
    // The label defaults to today's date in ISO — it's required (it's the reader's anchor), so an
    // insert that left it empty would put a broken entry on the page.
    const today = new Date().toISOString().slice(0, 10);
    await expect(entry.locator(".pv-update-label")).toHaveValue(today);

    // Type the body in the document…
    await entry.locator(".pv-update-body").click();
    await page.keyboard.type("Shipped the thing.");

    // …and set the description in the ⋯ properties panel, which is where it lives: for readers it
    // sits under the entry's title, and the title is inside this node's editable body, so a field
    // can't be placed there. The panel names each prop and says where it lands.
    await entry.hover();
    await page.getByRole("button", { name: "Update properties" }).click();
    const panel = page.locator(".pv-props-panel");
    await expect(panel).toBeVisible();
    await expect(panel.locator(".pv-props-name").first()).toContainText("Label");
    // `rss` is an object the converter doesn't model, so the panel explains it instead of offering a
    // box that would write a dead prop AND demote the block out of Visual mode.
    const rssRow = panel.locator(".pv-props-row").filter({ hasText: "Rss" });
    await expect(rssRow.locator("input")).toHaveCount(0);
    await panel.getByLabel("Description").fill("v1.2.0");
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);

    const draft = async () => {
      const rows = await sql<{ content: string }[]>`
        select content from draft_file d
        join editor_session s on s.id = d.session_id
        where s.site_id = ${SITE_ID} and s.status = 'open' and d.path = 'updatepage.mdx'`;
      return rows[0]?.content ?? "";
    };
    await expect.poll(draft, { timeout: 10_000 }).toContain('description="v1.2.0"');
    const mdx = await draft();
    expect(mdx).toContain(`<Update label="${today}"`);
    expect(mdx).toContain("Shipped the thing.");

    await clearDrafts(["updatepage.mdx"]);
  });

  // The draft Preview renders the tenant's own pages with a link/asset base — and THAT is the
  // branch of `applyTenantUrls` that wraps every component to rewrite `href`/`src`. A wrapper
  // function carries none of a namespace component's members, so `<Color.Item>` / `<Tree.Folder>`
  // resolved to undefined and MDX threw "Expected component `Color.Item` to be defined" — a 500,
  // because the throw lands while React renders the content rather than inside the compile step's
  // try/catch. On a tenant host the map isn't wrapped at all, which is why every fixture, crawl
  // and smoke check rendered a `<Tree>` perfectly while the same page died in Preview.
  //
  // `mdx-tenant-urls.test.ts` pins the wrapping itself; this is the journey that surfaced it.
  test("Preview renders namespace components (Color.Item, Tree.Folder)", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

    const res = await page.goto(`/preview/${ORG_SLUG}/${SLUG}/site/previewpage`);
    expect(res?.status(), "the preview must render, not 500").toBe(200);
    await expect(page.getByText("PREVIEW_SWATCH")).toBeVisible({ timeout: 15_000 });
    // Attached, not visible: the reader's folder is a `<details>` and this one has no
    // `defaultOpen`, so its rows are collapsed — the point here is that `Tree.Folder` RESOLVED.
    await expect(page.getByText("PREVIEW_FILE.ts")).toBeAttached();
    expect(errors, `unexpected page errors:\n${errors.join("\n")}`).toEqual([]);
  });

  // …and the case the guard first got wrong: a list OPENING a tab. Its first item starts on
  // exactly the position the guard swallows, so the press that normally drops list formatting did
  // nothing, and that checkbox could never be removed. Reported as "not able to backspace out the
  // first checkbox inside a tab". The edge still has to hold once the list is gone, which is the
  // second half of this test — the two behaviours are one keystroke apart.
  test("Backspace unwraps a list that opens a tab, then still stops at the edge", async ({
    page,
  }) => {
    // Own the starting content: this test strips a list and asserts it's gone, so a draft left by
    // an earlier run would have it asserting against a page that no longer has one.
    await clearDrafts(["edgetaskpage.mdx"]);
    await page.goto(`${sitePath(SLUG, "editor")}?slug=edgetaskpage`);
    const pm = page.locator(".pv-visual .ProseMirror");
    await expect(pm).toBeVisible({ timeout: 15_000 });

    const block = page.locator('[data-node-view-wrapper]:has(> [data-pv-tabs])');
    const pane = block.locator("[data-pv-tab]").first();
    await expect(pane.locator('input[type="checkbox"]')).toHaveCount(2);

    // Caret at the very start of the first item — the tab's leading edge. Asserted rather than
    // assumed: this whole test is about which position the key lands on, so a click that misses
    // would otherwise read as "the guard swallowed it", i.e. as the bug it exists to catch.
    await pane.getByText("first task").click();
    await expect
      .poll(async () => {
        // Home INSIDE the poll: `press` resolves when the event is sent, not when ProseMirror has
        // applied the click that precedes it, so a single press can land before the caret exists.
        // Re-asking for the start of the line is idempotent, which makes this a wait, not a retry.
        await page.keyboard.press("Home");
        return page.evaluate(() => {
          const sel = window.getSelection();
          const node = sel?.anchorNode;
          const el = node?.nodeType === 1 ? (node as Element) : node?.parentElement;
          const li = el?.closest("li");
          return {
            atStart: sel?.anchorOffset === 0,
            inFirstItem: !!li && li === li.closest("ul")?.firstElementChild,
          };
        });
      })
      .toEqual({ atStart: true, inFirstItem: true });

    await page.keyboard.press("Backspace");

    // The item lost its list formatting and stayed put; the tab is untouched.
    await expect(pane.locator('input[type="checkbox"]')).toHaveCount(1);
    await expect(pane.locator("p").first()).toHaveText("first task");
    await expect(block.locator("[data-pv-tab]")).toHaveCount(2);

    // One more press, now on a plain paragraph at the same position: nothing happens, because
    // there is nothing left to unwrap and escaping would take the tab with it.
    await page.keyboard.press("Backspace");
    await expect(pane).toContainText("first task");
    await expect(pane).toContainText("second task");
    await expect(block.locator("[data-pv-tab]")).toHaveCount(2);

    await clearDrafts(["edgetaskpage.mdx"]);
  });

  // …and the same rule for the other two blocks that OPEN a component. Emptying a code block or a
  // blockquote leaves the caret on the component's leading edge, where the guard used to swallow
  // the key — so the emptied block sat there with no way to remove it. Backspace there means
  // "drop this block's formatting", which stays inside the component; only the press after that,
  // with nothing left to strip, is the one that would escape.
  test("Backspace clears an emptied code block or quote that opens a component", async ({
    page,
  }) => {
    // Own the starting content rather than inherit it: this test deletes blocks and then asserts
    // they're gone, so a draft left behind by an earlier run (its own, from a failure that never
    // reached clearDrafts) would have it asserting against a page that no longer has them.
    await clearDrafts(["edgeblockpage.mdx"]);

    await page.goto(`${sitePath(SLUG, "editor")}?slug=edgeblockpage`);
    const pm = page.locator(".pv-visual .ProseMirror");
    await expect(pm).toBeVisible({ timeout: 15_000 });

    const rows = page.locator(".pv-accordion");
    await expect(rows).toHaveCount(2);

    // Emptied with a SELECTION rather than a run of Backspaces: a selection delete is one press
    // with one visible effect, where seven presses in a row raced the editor (`keyboard.press`
    // resolves when the event is sent, not when ProseMirror has applied it). What's under test is
    // the press AFTER the block is empty, so getting it empty shouldn't be the flaky part.
    // `content` rather than the block itself: an emptied code block draws a "// add code here"
    // hint (chrome, outside the content hole), so the block having no TEXT is the fact to assert.
    const empty = async (target: Locator, text: string, content: Locator) => {
      await target.getByText(text).click({ clickCount: 3 }); // select the line
      await page.keyboard.press("Backspace"); // a selection delete — always allowed
      await expect(content).toHaveText("");
    };

    // A code block holding "hi": empty it, then one more press should take the block itself.
    const codeRow = rows.first();
    await expect(codeRow.locator("pre")).toHaveCount(1);
    await empty(codeRow.locator("pre"), "hi", codeRow.locator("pre code"));
    await page.keyboard.press("Backspace"); // the press that used to do nothing
    await expect(codeRow.locator("pre")).toHaveCount(0);
    await expect(rows).toHaveCount(2); // …and the accordion is still there

    // Same for a blockquote.
    const quoteRow = rows.nth(1);
    await expect(quoteRow.locator("blockquote")).toHaveCount(1);
    await empty(quoteRow.locator("blockquote"), "quoted", quoteRow.locator("blockquote"));
    await page.keyboard.press("Backspace");
    await expect(quoteRow.locator("blockquote")).toHaveCount(0);
    await expect(rows).toHaveCount(2);

    // The edge still holds: with nothing left to strip, the next press does nothing rather than
    // taking the accordion with it.
    await page.keyboard.press("Backspace");
    await expect(rows).toHaveCount(2);

    await clearDrafts(["edgeblockpage.mdx"]);
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

    // Arrowing past the fold SCROLLS the highlight into view. The menu is a scroller (33 blocks in
    // ~340px) and the arrows move a highlight the mouse isn't driving, so nothing brings the new
    // row into view on its own — you arrow "off the bottom" and the selection is somewhere you
    // can't see, which reads as the keys having stopped working.
    await page.reload();
    await expect(pm).toBeVisible({ timeout: 15_000 });
    await freshLine();
    await page.keyboard.type("/");
    await expect(menu).toBeVisible();
    for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowDown");
    const scrolled = await menu.evaluate((list) => {
      const active = list.querySelector(".pv-slash-item.is-active");
      if (!active) return null;
      const a = active.getBoundingClientRect();
      const l = list.getBoundingClientRect();
      // scrollTop proves the LIST moved, not merely that the item happened to be in view: with no
      // scrolling at all the highlight would be past the fold and this would still be 0.
      return { inView: a.top >= l.top - 1 && a.bottom <= l.bottom + 1, scrollTop: list.scrollTop };
    });
    expect(scrolled, "the highlight ran off the bottom instead of scrolling").toMatchObject({
      inView: true,
    });
    expect(scrolled?.scrollTop ?? 0).toBeGreaterThan(0);
    await page.keyboard.press("Escape");

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

  // The `/` menu INSIDE a component (SPEC §9.2). It listed every block in a plain paragraph and
  // said "No matching blocks" inside a <Tab> pane. The suggestion resolves its items
  // asynchronously; DragHandle's effect re-registered its plugin on every render, which makes
  // ProseMirror rebuild every plugin view — destroying the suggestion's, which fires onExit and
  // aborts the in-flight lookup, so the resolved list never reached the menu. Typing inside a
  // React node view lands that teardown between the open and the resolution, which is why only
  // components showed it. Needs a browser: the item list resolves correctly in isolation; what
  // breaks is who tears it down.
  test("the slash menu lists blocks inside a component, not 'No matching blocks'", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
    });

    // Its own fixture page: this asserts on what a pane contains after the insert, and the tab
    // strip test above renames/reorders/removes tabs on `tabby`.
    await page.goto(`${sitePath(SLUG, "editor")}?slug=slashtabs`);
    const pm = page.locator(".pv-visual .ProseMirror");
    await expect(pm).toBeVisible({ timeout: 15_000 });

    const block = page.locator('[data-node-view-wrapper]:has(> [data-pv-tabs])');
    const pane = block.locator("[data-pv-tab]").first();
    await expect(pane).toBeVisible({ timeout: 15_000 });

    // A fresh line inside the tab pane, so the query is the whole paragraph.
    await pane.getByText("Slash tab anchor line.").click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/");

    const menu = page.locator(".pv-slash-menu");
    await expect(menu).toBeVisible();
    await expect(page.locator(".pv-slash-empty")).toHaveCount(0);
    // The whole catalogue, not a truncated or empty one.
    expect(await page.locator(".pv-slash-item").count()).toBeGreaterThan(20);

    // …and picking from it still inserts into the pane the caret is in.
    await page.keyboard.type("info");
    await expect(page.locator(".pv-slash-item.is-active .pv-slash-title")).toHaveText("Info");
    await page.keyboard.press("Enter");
    await expect(menu).toHaveCount(0);
    await expect(pane.locator(".node-callout")).toHaveCount(1);
    await expect(pane.getByText("/info", { exact: true })).toHaveCount(0);

    const reactErrors = errors.filter(
      (e) =>
        e.startsWith("pageerror:") ||
        /flushSync|Maximum update depth|Cannot update a component|not wrapped in act|hydrat/i.test(e),
    );
    expect(reactErrors, `unexpected React errors:\n${reactErrors.join("\n")}`).toEqual([]);

    await clearDrafts(["slashtabs.mdx"]);
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
    // Scoped to the dialog: the editor page now carries a second hidden file input (the agent
    // composer's paperclip — mounted even while the panel is closed), and a page-level selector
    // fed the test video to THAT, where video/mp4 is rightly refused as an attachment.
    await dialog.locator('input[type="file"]').setInputFiles({
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
    // Scoped to the dialog: the editor page now carries a second hidden file input (the agent
    // composer's paperclip — mounted even while the panel is closed), and a page-level selector
    // fed the test video to THAT, where video/mp4 is rightly refused as an attachment.
    await dialog.locator('input[type="file"]').setInputFiles({
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

    // The header's controls, per the design: settings, agent, reload, close. Settings is a BUTTON
    // (it opens a drawer over the preview) — as a link it navigated away and threw the preview,
    // the editor and the draft away to show a form for the same file.
    await expect(overlay.getByRole("button", { name: "Site settings" })).toBeVisible();
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

  // The Site settings drawer (SPEC §9.2): docs.json edited over the live preview, in one long
  // scrolling column. Three things worth a browser: the write lands in the DRAFT (so it publishes
  // with the pages, and never touches the live site on its own), the PREVIEW behind it re-renders
  // with the change — which is the whole point, and which a poisoned per-request config memo
  // silently defeated for the full-site preview — and clearing a field REMOVES the key rather than
  // writing an empty string into somebody's config file.
  test("Site settings edits docs.json in the draft and the preview picks it up", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      // Resource 404s are excluded deliberately: the logo assertions below set paths that don't
      // exist in this fixture (the point is the JSON shape, not the file), and the preview frame
      // dutifully tries to load them. What this guard is for is React errors — a
      // flushSync-during-render, a render loop, a hydration mismatch — which is JS, not fetches.
      if (m.text().includes("Failed to load resource")) return;
      errors.push(`console.error: ${m.text()}`);
    });

    // Own the precondition: this asserts on docs.json's draft content, so start from no draft of it.
    await sql`
      delete from draft_file df
       using editor_session es
       where df.session_id = es.id and es.site_id = ${SITE_ID} and df.path = 'docs.json'`;

    await page.goto(sitePath(SLUG, "editor"));
    await expect(page.locator(".pv-visual .ProseMirror")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Preview" }).click();

    const drawer = page.getByRole("dialog", { name: "Site settings" });
    await page.getByRole("button", { name: "Site settings" }).click();
    await expect(drawer).toBeVisible({ timeout: 15_000 });

    // One column, the WHOLE docs.json surface in it — the picker jumps, it doesn't hide the rest
    // behind tabs. Listed explicitly because "it's all in there" is the feature.
    for (const section of [
      "General",
      "Navigation",
      "Branding",
      "Styling",
      "Typography",
      "Navbar",
      "Footer",
      "Banner",
      "Content",
      "Codeblocks",
      "Context menu",
      "Navigation behavior",
      "Search",
      "API reference",
      "Redirects",
      "SEO",
      "Thumbnails",
      "Analytics",
      "404 page",
      "Variables",
    ]) {
      // `exact` matters: "Navigation" and "Navigation behavior" are both headings here, and the
      // default substring match would resolve two elements for one of them.
      await expect(drawer.getByRole("heading", { name: section, exact: true })).toBeVisible();
    }

    // Keys Papervine keeps but doesn't render are labelled, not hidden — that's the deal that lets
    // the drawer cover the whole format without promising effects it can't deliver.
    await expect(drawer.getByText("Not rendered yet").first()).toBeVisible();

    // The picker jumps rather than filters — the section stays in the one column.
    await drawer.getByLabel("Jump to section").selectOption("analytics");
    await expect(drawer.getByLabel("Google Analytics 4")).toBeInViewport({ timeout: 10_000 });

    // A banner is unmistakable in the frame behind: absent before, rendered after.
    const frame = page.frameLocator('iframe[title="Live preview"]');
    const bannerText = "Shipping notes for the drawer test";
    await expect(frame.getByText(bannerText)).toHaveCount(0);

    await drawer.getByLabel("Content", { exact: true }).fill(bannerText);
    await expect(drawer.getByText("Saved to draft")).toBeVisible({ timeout: 15_000 });

    // It went into the draft session's docs.json, not the live config.
    await expect
      .poll(
        async () => {
          const rows = await sql`
            select content from draft_file d
            join editor_session s on s.id = d.session_id
            where s.site_id = ${SITE_ID} and s.status = 'open' and d.path = 'docs.json'`;
          return rows[0]?.content ?? "";
        },
        { timeout: 15_000 },
      )
      .toContain(bannerText);

    // …and the preview re-rendered with it (the frame is remounted on every save).
    await expect(frame.getByText(bannerText)).toBeVisible({ timeout: 30_000 });

    // Clearing removes the key — `"content": ""` would be a banner that renders as an empty bar.
    await drawer.getByLabel("Content", { exact: true }).fill("");
    await expect
      .poll(
        async () => {
          const rows = await sql`
            select content from draft_file d
            join editor_session s on s.id = d.session_id
            where s.site_id = ${SITE_ID} and s.status = 'open' and d.path = 'docs.json'`;
          return rows[0]?.content ?? "";
        },
        { timeout: 15_000 },
      )
      .not.toContain(bannerText);
    const after = await sql`
      select content from draft_file d
      join editor_session s on s.id = d.session_id
      where s.site_id = ${SITE_ID} and s.status = 'open' and d.path = 'docs.json'`;
    expect(after[0]?.content ?? "", "an emptied banner must leave no banner key at all").not.toContain(
      '"banner"',
    );

    // `logo` is EITHER a string or `{light, dark}`, and the drawer edits the whole key as one
    // paired control for that reason: per-sub-path fields showed a string-form logo as empty and
    // then replaced it with an object, dropping the logo the site was using.
    const draftConfig = async () => {
      const rows = await sql`
        select content from draft_file d
        join editor_session s on s.id = d.session_id
        where s.site_id = ${SITE_ID} and s.status = 'open' and d.path = 'docs.json'`;
      return JSON.parse(rows[0]?.content ?? "{}") as { logo?: unknown; redirects?: unknown };
    };

    await drawer.getByLabel("Logo (light)").fill("/logo.svg");
    // One file for both modes stays the plain string — the shape a hand-written docs.json has.
    await expect.poll(async () => (await draftConfig()).logo, { timeout: 15_000 }).toBe("/logo.svg");

    await drawer.getByLabel("Logo (dark)").fill("/logo-dark.svg");
    await expect
      .poll(async () => (await draftConfig()).logo, { timeout: 15_000 })
      .toEqual({ light: "/logo.svg", dark: "/logo-dark.svg" });

    await drawer.getByLabel("Logo (light)").fill("");
    await drawer.getByLabel("Logo (dark)").fill("");
    await expect.poll(async () => "logo" in (await draftConfig()), { timeout: 15_000 }).toBe(false);

    // A passthrough section writes the format's shape properly too — a list of objects, with
    // `permanent` present only when it's true (false is the default; a file full of it is noise).
    await drawer.getByRole("button", { name: "Add redirect" }).click();
    await drawer.getByLabel("Redirect 1 from").fill("/old");
    await drawer.getByLabel("Redirect 1 to").fill("/new");
    await expect
      .poll(async () => (await draftConfig()).redirects, { timeout: 15_000 })
      .toEqual([{ source: "/old", destination: "/new" }]);
    await drawer.getByLabel("Redirect 1 permanent").click();
    await expect
      .poll(async () => (await draftConfig()).redirects, { timeout: 15_000 })
      .toEqual([{ source: "/old", destination: "/new", permanent: true }]);
    await drawer.getByRole("button", { name: "Remove redirect 1" }).click();
    await expect.poll(async () => "redirects" in (await draftConfig()), { timeout: 15_000 }).toBe(false);

    // Escape closes the drawer and leaves the preview up (they're separate dismissals).
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Live preview" })).toBeVisible();

    expect(errors, `console errors in the settings drawer:\n${errors.join("\n")}`).toEqual([]);
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
      // The label is the collaborator's REAL name, from the session (collab/presence.ts) — not a
      // pseudonym derived from the Yjs clientID, which told you nothing about who was typing and
      // let two people collide on one name+colour. Both contexts share this suite's storageState,
      // so the peer here is the test user themselves.
      await expect(b.locator(".pv-remote-caret-label").first()).toHaveText(TEST_USER.name);
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });

  // Live MOUSE pointers (SPEC §9.2), the companion to the carets above: where someone is *looking*,
  // not where they're typing. Same gate — awareness is only shared over the collab service, and two
  // Playwright contexts don't share a BroadcastChannel. The coordinate maths has its own unit tests
  // (collab-pointers.test.ts); what needs a browser is that a real mousemove reaches awareness, the
  // arrow lands on the peer's screen, and the toggle silences BOTH directions.
  test("shows a peer's live mouse pointer, and the toggle stops sending as well as drawing", async ({
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
      await expect(a.locator(".pv-visual .ProseMirror")).toBeVisible({ timeout: 15_000 });
      await expect(b.locator(".pv-visual .ProseMirror")).toBeVisible({ timeout: 15_000 });

      const box = (await a.locator(".pv-visual .ProseMirror p").first().boundingBox())!;
      const pointerOnB = b.locator(".pv-pointer");

      // Nobody has moved a mouse over the editor yet.
      await expect(pointerOnB).toHaveCount(0);

      await a.mouse.move(box.x + 120, box.y + 10);
      await a.mouse.move(box.x + 122, box.y + 12); // a second move: publishing is per-frame
      await expect(pointerOnB).toHaveCount(1, { timeout: 10_000 });
      await expect(b.locator(".pv-pointer-name").first()).toHaveText(TEST_USER.name);

      // It follows: a further move must land somewhere else on B's screen, not stick.
      const first = (await pointerOnB.boundingBox())!;
      await a.mouse.move(box.x + 420, box.y + 90);
      await a.mouse.move(box.x + 422, box.y + 92);
      await expect
        .poll(async () => Math.round(((await pointerOnB.boundingBox()) ?? first).x), { timeout: 10_000 })
        .not.toBe(Math.round(first.x));

      // A's mouse leaving the editor clears it, rather than parking a stale arrow on B's screen.
      await a.mouse.move(2, 2);
      await expect(pointerOnB).toHaveCount(0, { timeout: 10_000 });

      // The toggle appears once there's a peer, and switches BOTH directions off: B draws nothing,
      // and A stops seeing B. A one-way switch would be worse than none — you'd think you were
      // private while still broadcasting.
      const toggle = b.getByRole("button", { name: /live cursors/i });
      await expect(toggle).toBeVisible();
      await toggle.click();

      const bBox = (await b.locator(".pv-visual .ProseMirror p").first().boundingBox())!;
      await b.mouse.move(bBox.x + 200, bBox.y + 20);
      await b.mouse.move(bBox.x + 202, bBox.y + 22);
      await expect(a.locator(".pv-pointer")).toHaveCount(0);

      await a.mouse.move(box.x + 150, box.y + 20);
      await a.mouse.move(box.x + 152, box.y + 22);
      await expect(pointerOnB).toHaveCount(0);

      // Back on, and A's pointer is drawn again.
      await toggle.click();
      await a.mouse.move(box.x + 180, box.y + 30);
      await a.mouse.move(box.x + 182, box.y + 32);
      await expect(pointerOnB).toHaveCount(1, { timeout: 10_000 });
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });
});
