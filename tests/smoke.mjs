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
    include: ["Fixtures Home", "Components &amp; Code", "Guide (md)"],
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
  log(`\n✓ all ${CHECKS.length} pages + ${SEARCH_CHECKS.length} search checks passed`);
  process.exit(0);
}

run();
