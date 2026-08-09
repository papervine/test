// Serve a standalone "customer site" that embeds the real widget snippet, for poking at
// the embeddable assistant widget (SPEC §8.7) manually. The widget's whole point is running
// on a THIRD-PARTY origin, so testing it same-origin inside the app would hide the class of
// bugs that actually bit this feature (a CORS bug, a citation-link-resolves-to-the-wrong-host
// bug — both cross-origin-only, invisible from inside the app itself).
//
// Ensures the target site is widget-enabled and merges this page's own origin into whatever
// allowed origins are already configured (never overwrites), then serves the snippet in the
// shapes real customers use: the default two-script init() call, the single-tag
// data-widget-id auto-init, a bare loader for driving init() yourself from devtools, and a
// /custom route for exercising the full option surface without editing any files.
//
//   node --env-file=.env.local scripts/widget-playground.mjs
//   node --env-file=.env.local scripts/widget-playground.mjs --slug starter-gated --port 8081
//   node --env-file=.env.local scripts/widget-playground.mjs --app-port 3001
//
// Requires `npm run dev` (or dev:app) already running and docker compose up (Postgres).
// Auto-detects the app's port by probing for a live embed.js if --app-port isn't given —
// Next auto-picks the next free port when :3000 is busy, so multiple worktrees coexist.
// Ctrl+C to stop; the DB changes (widget enabled + this origin allowlisted) are left in
// place, harmless for local dev.
import http from "node:http";
import { randomUUID } from "node:crypto";
import postgres from "postgres";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const DATABASE_URL = process.env.DATABASE_URL ?? "";

// Same guard as scripts/seed-dev.mjs: this mutates widget_enabled + widget_allowed_origins,
// which must never happen against a real customer's site.
const dbHost = (() => {
  try {
    return new URL(DATABASE_URL).hostname;
  } catch {
    return "";
  }
})();
if (!["localhost", "127.0.0.1"].includes(dbHost)) {
  console.error(
    `✗ Refusing to run: DATABASE_URL host is "${dbHost || "(unparseable)"}", not localhost.\n` +
      `  This script enables the widget and allowlists a local origin — local dev DB only.`,
  );
  process.exit(1);
}

const slug = arg("slug", "starter");
const port = Number(arg("port", "8080"));
const playgroundOrigin = `http://localhost:${port}`;

async function detectAppPort(explicit) {
  if (explicit) return Number(explicit);
  for (const candidate of [3000, 3001, 3002, 3003, 3004, 3005]) {
    try {
      // Generous timeout: Next dev compiles a route on-demand on its first request, and a
      // cold /api/widget/embed.js can easily take a couple of seconds — a short timeout
      // here misreads "still compiling" as "nothing listening" and skips a live port.
      const res = await fetch(`http://localhost:${candidate}/api/widget/embed.js`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) return candidate;
    } catch {
      // not listening — try the next candidate
    }
  }
  console.warn("⚠ couldn't auto-detect the app's port, falling back to 3000 (override with --app-port)");
  return 3000;
}

const appPort = await detectAppPort(arg("app-port"));
const appOrigin = `http://localhost:${appPort}`;

const sql = postgres(DATABASE_URL, { max: 1 });
const [site] = await sql`
  select id, widget_id, widget_enabled, widget_allowed_origins from site where slug = ${slug} limit 1`;
if (!site) {
  await sql.end();
  throw new Error(`site '${slug}' not found — run: npm run db:seed`);
}

const origins = new Set(site.widget_allowed_origins ?? []);
const alreadyConfigured = site.widget_enabled && origins.has(playgroundOrigin) && site.widget_id;
origins.add(playgroundOrigin);
// A freshly-seeded site has no widget_id — the app only mints one lazily on the first
// Settings → Widget visit (SPEC §8.7). Mint it here too, same `widget_${uuid}` shape, so
// this script never depends on having clicked through the dashboard first.
const widgetId = site.widget_id ?? `widget_${randomUUID()}`;
if (!alreadyConfigured) {
  await sql`
    update site set widget_enabled = true, widget_id = ${widgetId},
      widget_allowed_origins = ${sql.json([...origins])}
    where id = ${site.id}`;
  console.log(`  configured: widget enabled + ${playgroundOrigin} allowlisted for '${slug}'`);
}
await sql.end();

function page(title, body) {
  return `<!doctype html>\n<html><head><meta charset="utf-8"></head><body>\n<h1>${title}</h1>\n${body}\n</body></html>`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, playgroundOrigin);

  if (url.pathname === "/single-tag") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(
      page(
        `Widget playground — ${slug} (single-tag)`,
        `<script type="module" src="${appOrigin}/api/widget/embed.js" data-widget-id="${widgetId}"></script>`,
      ),
    );
    return;
  }

  if (url.pathname === "/bare") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(
      page(
        `Widget playground — ${slug} (bare)`,
        `<script type="module" src="${appOrigin}/api/widget/embed.js"></script>
<p>No auto-init. Drive it from devtools:</p>
<pre>await window.PapervineAssistant.init({ id: "${widgetId}", theme: "light" });</pre>`,
      ),
    );
    return;
  }

  if (url.pathname === "/custom") {
    // Raw query-string interpolation into inline JS — fine here, this is a local-only dev
    // tool with no other visitor, not something that ever serves untrusted traffic.
    const opts = url.searchParams.get("opts") ?? "{}";
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(
      page(
        `Widget playground — ${slug} (custom)`,
        `<script type="module" src="${appOrigin}/api/widget/embed.js"></script>
<script type="module">
  await window.PapervineAssistant.init({ id: "${widgetId}", ...${opts} });
</script>`,
      ),
    );
    return;
  }

  if (url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(
      page(
        `Widget playground — ${slug}`,
        `<script type="module" src="${appOrigin}/api/widget/embed.js"></script>
<script type="module">
  await window.PapervineAssistant.init({ id: "${widgetId}" });
</script>`,
      ),
    );
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
});

server.listen(port, () => {
  console.log(`\nWidget playground for '${slug}' (${widgetId})`);
  console.log(`  app origin: ${appOrigin}`);
  console.log(`\n  ${playgroundOrigin}/                                     default init()`);
  console.log(`  ${playgroundOrigin}/single-tag                          data-widget-id auto-init`);
  console.log(`  ${playgroundOrigin}/bare                                loader only, init() yourself`);
  console.log(`  ${playgroundOrigin}/custom?opts={"theme":"light"}       custom init() options`);
  console.log(`\nCtrl+C to stop.\n`);
});
