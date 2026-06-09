#!/usr/bin/env node
/**
 * End-to-end regression smoke test.
 *
 * Boots the real renderer against tests/fixtures (a docs repo that exercises every
 * M1 fix) and crawls each page, asserting it renders without a 500. This is the
 * automated version of the manual `docbot dev` crawl we used to validate against
 * representative docs repos — it guards the GAP-REPORT fixes from regressing.
 *
 * No test framework: pure Node + fetch. Run with `npm test`.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const PKG_ROOT = process.cwd();
const PORT = Number(process.env.SMOKE_PORT ?? 4178);
// 127.0.0.1, not localhost: on some CI runners localhost resolves to IPv6 ::1
// first while `next dev` listens on IPv4, so requests never connect.
const BASE = `http://127.0.0.1:${PORT}`;
const FIXTURES = path.resolve(PKG_ROOT, "tests/fixtures");
const nextBin = path.join(PKG_ROOT, "node_modules", ".bin", "next");

// slug, then content assertions. Every page must return HTTP 200 (i.e. never 500).
const CHECKS = [
  {
    slug: "",
    desc: "home renders (object favicon + languages nav + lenient config)",
    // theme tokens wired: no `theme` in fixtures → default "mint", token vars injected.
    include: ["Fixtures Home", "Components &amp; Code", "Guide (md)", 'data-theme="mint"', "--db-radius"],
    exclude: ["Hidden Page"], // hidden:true → not in sidebar
  },
  { slug: "guide", desc: ".md files are served", include: ["PLAIN_MD_MARKER"] },
  { slug: "components", desc: "shiki highlighting + code group", include: ["shiki", "console"] },
  {
    slug: "cards",
    desc: "standalone + grouped cards render",
    include: ["CARD_ONE_MARKER", "CARD_TWO_MARKER", "CARD_A_MARKER", "card-link"],
  },
  {
    slug: "unknowns",
    desc: "unknown + member-expr components degrade to children",
    include: ["UNKNOWN_CHILD_MARKER", "MEMBER_EXPR_MARKER"],
    exclude: ["Expected component"],
  },
  { slug: "badfrontmatter", desc: "malformed frontmatter doesn't crash", include: ["BAD_FRONTMATTER_MARKER"] },
  {
    slug: "with-snippet",
    desc: "unresolved snippet import degrades gracefully (200, not 500)",
    include: ["couldn", "rendered"], // the "couldn’t be fully rendered yet" notice
  },
  { slug: "hidden", desc: "hidden page reachable by URL", include: ["HIDDEN_PAGE_MARKER"] },
  {
    slug: "list-users",
    desc: "OpenAPI: GET endpoint page (params + response schema)",
    include: ["GET", "/users", "limit", "Max users to return"],
  },
  {
    slug: "create-user",
    desc: "OpenAPI: POST endpoint page (request body schema)",
    include: ["POST", "email", "Display name"],
  },
  {
    slug: "get-user",
    desc: "OpenAPI: path parameter rendered",
    include: ["The user ID"],
  },
];

// Full-text search (SPEC.md §6) via /api/search. Backed by search-fixture.mdx
// (indexed) and search-noindex.mdx (excluded), which use nonsense terms so the
// assertions can't collide with other fixture content. We assert on which hrefs
// come back — not on ranking order or snippet text, which would be brittle.
const SEARCH_CHECKS = [
  { q: "zebra", desc: "title match returns the page", expect: "/search-fixture" },
  { q: "wombat", desc: "body term resolves to the section anchor", expect: "/search-fixture#quokka-section" },
  { q: "womb", desc: "prefix match works", expect: "/search-fixture#quokka-section" },
  { q: "platypus", desc: "noindex pages are excluded from the index", expectEmpty: true },
];

// Control plane (SPEC §10, Layer-1 auth). Deliberately DB-free so it runs in CI
// with no Postgres: the middleware gate redirects before any DB query, and the
// auth pages are client-rendered. Guards the (docs)/(auth)/(app) route-group
// split and the /dashboard session gate from regressing.
const CONTROL_PLANE_CHECKS = [
  {
    path: "/dashboard",
    desc: "unauthenticated /dashboard redirects to /login (middleware gate)",
    redirectTo: "/login",
  },
  {
    path: "/dashboard/connect",
    desc: "unauthenticated /dashboard/connect redirects to /login",
    redirectTo: "/login",
  },
  {
    path: "/dashboard/analytics",
    desc: "unauthenticated /dashboard/analytics redirects to /login",
    redirectTo: "/login",
  },
  {
    path: "/login",
    desc: "login page renders in the platform theme (shell + gradient CTA)",
    // `db-glow` proves PlatformShell wraps it; `db-cta` proves the shared Button is used.
    // Guards the platform theme from regressing back to the old emerald/system look.
    include: ["Sign in to Docbot", "db-glow", "db-cta"],
  },
  {
    path: "/signup",
    desc: "signup page renders in the platform theme (shell + gradient CTA)",
    include: ["Create your Docbot account", "db-glow", "db-cta"],
  },
];

function log(msg) {
  process.stdout.write(msg + "\n");
}

async function waitForReady(timeoutMs = 180_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(BASE + "/", { signal: AbortSignal.timeout(15_000) });
      if (res.status === 200) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("server did not become ready in time");
}

async function run() {
  log(`▶ booting renderer against ${FIXTURES} on :${PORT}`);
  const server = spawn(nextBin, ["dev", "-H", "0.0.0.0", "-p", String(PORT)], {
    cwd: PKG_ROOT,
    env: { ...process.env, DOCBOT_CONTENT: FIXTURES },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  server.stdout.on("data", (d) => (serverLog += d));
  server.stderr.on("data", (d) => (serverLog += d));

  const failures = [];
  try {
    await waitForReady();
    for (const check of CHECKS) {
      const before = failures.length;
      const url = `${BASE}/${check.slug}`;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        const body = await res.text();
        if (res.status !== 200) {
          failures.push(`[${check.slug || "/"}] expected 200, got ${res.status} — ${check.desc}`);
        } else {
          for (const needle of check.include ?? []) {
            if (!body.includes(needle)) failures.push(`[${check.slug || "/"}] missing "${needle}" — ${check.desc}`);
          }
          for (const needle of check.exclude ?? []) {
            if (body.includes(needle)) failures.push(`[${check.slug || "/"}] should NOT contain "${needle}" — ${check.desc}`);
          }
        }
      } catch (e) {
        failures.push(`[${check.slug || "/"}] request failed: ${e.message}`);
      }
      log(`  ${failures.length === before ? "✓" : "✗"} /${check.slug}  (${check.desc})`);
    }

    for (const check of SEARCH_CHECKS) {
      const before = failures.length;
      const tag = `search "${check.q}"`;
      try {
        const res = await fetch(`${BASE}/api/search?q=${encodeURIComponent(check.q)}`, {
          signal: AbortSignal.timeout(30_000),
        });
        if (res.status !== 200) {
          failures.push(`[${tag}] expected 200, got ${res.status} — ${check.desc}`);
        } else {
          const data = await res.json();
          const hrefs = (data.results ?? []).map((r) => r.href);
          if (check.expect && !hrefs.includes(check.expect)) {
            failures.push(`[${tag}] expected href "${check.expect}", got [${hrefs.join(", ")}] — ${check.desc}`);
          }
          if (check.expectEmpty && hrefs.length) {
            failures.push(`[${tag}] expected no results, got [${hrefs.join(", ")}] — ${check.desc}`);
          }
        }
      } catch (e) {
        failures.push(`[${tag}] request failed: ${e.message}`);
      }
      log(`  ${failures.length === before ? "✓" : "✗"} ${tag}  (${check.desc})`);
    }

    // Assistant route is wired (SPEC §8): 503 without ANTHROPIC_API_KEY, streams with one.
    {
      const before = failures.length;
      try {
        const res = await fetch(`${BASE}/api/assistant`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: [{ id: "1", role: "user", parts: [{ type: "text", text: "hi" }] }],
          }),
          signal: AbortSignal.timeout(30_000),
        });
        if (![200, 503].includes(res.status)) {
          failures.push(`[assistant] expected 200 or 503, got ${res.status}`);
        }
      } catch (e) {
        failures.push(`[assistant] request failed: ${e.message}`);
      }
      log(`  ${failures.length === before ? "✓" : "✗"} assistant route (200 w/ key, 503 without)`);
    }

    // Generated MCP server (SPEC §8.5). Streamable HTTP at /mcp. We assert the
    // tools are listed and a tools/call returns real docs — body substrings only,
    // so SSE-vs-JSON framing and tool ordering don't make this brittle. Fixtures
    // include an OpenAPI spec, so search_api must also be present.
    const mcpPost = (body) =>
      fetch(`${BASE}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    {
      const before = failures.length;
      try {
        const listRes = await mcpPost({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
        const listBody = await listRes.text();
        if (listRes.status !== 200) failures.push(`[mcp] tools/list expected 200, got ${listRes.status}`);
        for (const tool of ["search_docs", "read_page", "list_pages", "search_api"]) {
          if (!listBody.includes(`"${tool}"`)) failures.push(`[mcp] tools/list missing tool "${tool}"`);
        }
        const callRes = await mcpPost({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "search_docs", arguments: { query: "zebra" } },
        });
        const callBody = await callRes.text();
        if (!callBody.includes("/search-fixture")) {
          failures.push(`[mcp] search_docs("zebra") should return /search-fixture`);
        }
      } catch (e) {
        failures.push(`[mcp] request failed: ${e.message}`);
      }
      log(`  ${failures.length === before ? "✓" : "✗"} mcp server (/mcp tools/list + tools/call)`);
    }

    for (const check of CONTROL_PLANE_CHECKS) {
      const before = failures.length;
      const tag = `control-plane ${check.path}`;
      try {
        const res = await fetch(`${BASE}${check.path}`, {
          redirect: "manual",
          signal: AbortSignal.timeout(30_000),
        });
        if (check.redirectTo) {
          const loc = res.headers.get("location") ?? "";
          if (![301, 302, 303, 307, 308].includes(res.status) || !loc.includes(check.redirectTo)) {
            failures.push(`[${tag}] expected redirect to ${check.redirectTo}, got ${res.status} → "${loc}" — ${check.desc}`);
          }
        } else {
          const body = await res.text();
          if (res.status !== 200) {
            failures.push(`[${tag}] expected 200, got ${res.status} — ${check.desc}`);
          } else {
            for (const needle of check.include ?? []) {
              if (!body.includes(needle)) failures.push(`[${tag}] missing "${needle}" — ${check.desc}`);
            }
          }
        }
      } catch (e) {
        failures.push(`[${tag}] request failed: ${e.message}`);
      }
      log(`  ${failures.length === before ? "✓" : "✗"} ${tag}  (${check.desc})`);
    }
  } catch (e) {
    failures.push(`fatal: ${e.message}\n--- server log tail ---\n${serverLog.slice(-1500)}`);
  } finally {
    server.kill("SIGTERM");
  }

  if (failures.length) {
    log(`\n✗ ${failures.length} failure(s):`);
    for (const f of failures) log("  - " + f);
    process.exit(1);
  }
  log(
    `\n✓ all ${CHECKS.length} pages + ${SEARCH_CHECKS.length} search + ${CONTROL_PLANE_CHECKS.length} control-plane checks passed`,
  );
  process.exit(0);
}

run();
