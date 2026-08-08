import http from "node:http";
import type { AddressInfo } from "node:net";
import { test, expect } from "@playwright/test";
import postgres from "postgres";
import { TEST_USER, APEX_ORIGIN } from "./constants";
import { TEST_DB_URL } from "./global-setup";

// The real embed round-trip (SPEC §8.7): a widget loaded on a genuinely different origin
// (a plain Node http server on its own port — not the app's own host, since the whole
// point of this surface is that it works on someone ELSE's site) talks to the widget chat
// route and renders. Console-clean is the durable regression gate here, matching
// editor.spec.ts's pattern — a React/JS error is invisible in a screenshot but not in the
// console. Whether the AI actually answers depends on ANTHROPIC_API_KEY being configured
// in this environment; a graceful "unavailable" bubble is an equally valid outcome, so the
// assertion tolerates either — what it must NOT tolerate is an uncaught error.
const SITE = { id: "e2e-widget-embed-site", slug: "e2e-widget-embed", name: "Widget Embed E2E" };

let server: http.Server;
let hostOrigin: string;
let widgetId: string;

test.beforeAll(async () => {
  const sql = postgres(TEST_DB_URL, { max: 1 });
  const [org] = await sql`select id from organization where name = ${TEST_USER.org} limit 1`;
  expect(org, "expected the onboarded org").toBeTruthy();
  await sql`delete from site where id = ${SITE.id}`;
  widgetId = `widget_e2e_${Date.now()}`;
  await sql`insert into site (id, organization_id, name, slug, repo_owner, repo_name, branch, status,
                             widget_id, widget_enabled)
            values (${SITE.id}, ${org.id}, ${SITE.name}, ${SITE.slug}, 'acme', 'docs', 'main', 'live',
                    ${widgetId}, true)`;
  await sql.end();

  // Start the "customer site" AFTER we know its own origin, so the allowed-origins column
  // can be set to the exact value the widget chat route will see in the Origin header.
  // Two install methods, two paths: "/" is the explicit init() call, "/single-tag" is the
  // data-widget-id auto-init alternative — both must mount the same working widget.
  server = http.createServer((req, res) => {
    const singleTag = req.url === "/single-tag";
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(
      singleTag
        ? `<!doctype html>
<html><body>
<h1>Customer site (single tag)</h1>
<script type="module" src="${APEX_ORIGIN}/api/widget/embed.js" data-widget-id="${widgetId}"></script>
</body></html>`
        : `<!doctype html>
<html><body>
<h1>Customer site</h1>
<script type="module" src="${APEX_ORIGIN}/api/widget/embed.js"></script>
<script type="module">
  await window.PapervineAssistant.init({ id: "${widgetId}" });
</script>
</body></html>`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  hostOrigin = `http://127.0.0.1:${port}`;

  const sql2 = postgres(TEST_DB_URL, { max: 1 });
  await sql2`update site set widget_allowed_origins = ${sql2.json([hostOrigin])} where id = ${SITE.id}`;
  await sql2.end();
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const sql = postgres(TEST_DB_URL, { max: 1 });
  await sql`delete from site where id = ${SITE.id}`;
  await sql.end();
});

test("the widget mounts, opens, sends a message, and renders a reply with no console errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
  });

  await page.goto(hostOrigin);

  const launcher = page.locator(".pv-launcher");
  await expect(launcher).toBeVisible();
  await launcher.click();

  const input = page.locator(".pv-input");
  await input.fill("What is this docs site about?");
  await page.locator(".pv-send").click();

  // Either a real streamed answer or a graceful "unavailable"/refusal bubble — both are
  // acceptable outcomes here (whether the AI actually answers depends on this environment
  // having an AI provider configured AND the test org having a billing plan that permits
  // it — this spec seeds neither). An uncaught JS error is the only real failure.
  await expect(page.locator(".pv-msg.assistant, .pv-msg.error")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator(".pv-msg.assistant, .pv-msg.error")).not.toHaveText("", {
    timeout: 30_000,
  });

  // "Failed to load resource: ... 402/403/503" is Chrome logging ANY non-2xx fetch to the
  // console, regardless of whether the app handles it (ours does, per the assertion
  // above) — that's browser noise, not a bug. Only fail on signals of an actual JS/React
  // problem, mirroring editor.spec.ts's targeted pattern rather than a zero-tolerance
  // count that would also flag the widget's own deliberate error-handling path.
  const realErrors = errors.filter(
    (e) => e.startsWith("pageerror:") || !/Failed to load resource/.test(e),
  );
  expect(realErrors, `unexpected console errors:\n${realErrors.join("\n")}`).toEqual([]);
});

test("the single-tag data-widget-id variant auto-mounts with no console errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
  });

  await page.goto(`${hostOrigin}/single-tag`);

  // No init() call in this page's markup at all — the launcher appearing proves the
  // data-widget-id attribute alone triggered auto-mount.
  await expect(page.locator(".pv-launcher")).toBeVisible();

  const realErrors = errors.filter(
    (e) => e.startsWith("pageerror:") || !/Failed to load resource/.test(e),
  );
  expect(realErrors, `unexpected console errors:\n${realErrors.join("\n")}`).toEqual([]);
});

test("renders markdown (headings, lists, links, bold/italic/code) as real DOM, not raw syntax", async ({
  page,
}) => {
  // Regression: the widget used to render assistant text via `.textContent`, so a real
  // answer showed literal "## Heading" / "[text](url)" / "- item" syntax on screen
  // instead of formatted output. Deterministic — exercises the pure renderer directly
  // with fixed input, no AI call needed.
  await page.goto(hostOrigin);
  const html = await page.evaluate(() => {
    const md = [
      "## How Projects Work",
      "",
      "[docs.json projects](/what-is-docs#the-three-parts) consist of three main parts:",
      "",
      "1. **Your repository** - source of truth.",
      "2. **The dashboard** - for `settings`.",
      "",
      "- MDX files for every page",
      "- A `docs.json` file",
      "",
      "Some *italic* and **bold** text.",
    ].join("\n");
    // @ts-expect-error injected by the widget loader script
    return window.PapervineAssistant.renderMarkdownHTML(md);
  });

  expect(html).toContain("<h2>How Projects Work</h2>");
  expect(html).toContain('<a href="/what-is-docs#the-three-parts"');
  expect(html).toContain("<ol>");
  expect(html).toContain("<ul>");
  expect(html).toContain("<strong>Your repository</strong>");
  expect(html).toContain("<code>settings</code>");
  expect(html).toContain("<em>italic</em>");
  // No raw markdown syntax should survive into the rendered output.
  expect(html).not.toContain("##");
  expect(html).not.toContain("](/");
  expect(html).not.toMatch(/^- /m);
});

test("renders a GFM table as a real <table>, not squashed pipe-delimited text", async ({
  page,
}) => {
  // Regression: a table's rows fell into the generic paragraph bucket (no table
  // detection at all), and paragraph lines are joined with a space — so a multi-line
  // table collapsed onto one line of literal "| Header | ... | --- | ... |" text.
  await page.goto(hostOrigin);
  const html = await page.evaluate(() => {
    const md = [
      "Relationships:",
      "",
      "| Relationship | Cardinality |",
      "| --- | --- |",
      "| Studio -> Project | one to many |",
      "| Project -> Asset | one to many |",
    ].join("\n");
    // @ts-expect-error injected by the widget loader script
    return window.PapervineAssistant.renderMarkdownHTML(md);
  });

  expect(html).toContain("<table>");
  expect(html).toContain("<thead>");
  expect(html).toContain("<th>Relationship</th>");
  expect(html).toContain("<th>Cardinality</th>");
  expect(html).toContain("<td>Studio -&gt; Project</td>");
  expect(html).toContain("<td>one to many</td>");
  // The separator row must never render as a body row.
  expect(html).not.toContain("<td>---</td>");
  expect(html).not.toContain("| ---");
});

test("neutralizes a malicious link scheme and HTML in the AI's own output", async ({ page }) => {
  await page.goto(hostOrigin);
  const html = await page.evaluate(() => {
    const md = "Click [here](javascript:alert(1)) or <script>alert(2)</script>.";
    // @ts-expect-error injected by the widget loader script
    return window.PapervineAssistant.renderMarkdownHTML(md);
  });

  expect(html).toContain('href="#"'); // javascript: defused to a safe anchor
  expect(html).not.toContain("javascript:");
  expect(html).not.toContain("<script>alert(2)</script>"); // escaped as text, not executed
  expect(html).toContain("&lt;script&gt;");
});

test("rejects a request from an origin outside the allowlist", async ({ request }) => {
  const res = await request.post(`${APEX_ORIGIN}/api/widget/${widgetId}/chat`, {
    headers: { origin: "https://not-allowed.example", "content-type": "application/json" },
    data: { messages: [] },
  });
  expect(res.status()).toBe(403);
  expect(res.headers()["access-control-allow-origin"]).toBeUndefined();
});
