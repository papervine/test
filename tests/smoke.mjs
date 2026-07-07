#!/usr/bin/env node
/**
 * End-to-end regression smoke test.
 *
 * Boots the real renderer against tests/fixtures (a docs repo that exercises every
 * M1 fix) and crawls each page, asserting it renders without a 500. This is the
 * automated version of the manual `papervine dev` crawl we use to validate against
 * representative docs repos — it guards the GAP-REPORT fixes from regressing.
 *
 * No test framework: pure Node + fetch. Run with `npm test`.
 */
import { spawn } from "node:child_process";
import http from "node:http";
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
    desc: "home renders (favicon links + object favicon + languages nav + lenient config)",
    // theme tokens wired: no `theme` in fixtures → default "mint", token vars injected.
    // favicon: fixtures set `{ light, dark }` → a <link rel="icon"> per scheme (apex, so the
    // path is root-absolute, assetBase empty). appearance is unset → the theme toggle shows.
    include: [
      "Fixtures Home", "Components &amp; Code", "Guide (md)", 'data-theme="mint"', "--db-radius",
      'rel="icon"', 'href="/favicon.ico"', "prefers-color-scheme: dark",
      'aria-label="Toggle theme"',
    ],
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
  {
    slug: "images",
    desc: "markdown AND literal <img> images get manifest dimensions + next/image; external stays plain",
    // hero.png is 120x60 (markdown image) and wide.png is 200x100 (a LITERAL <img> in a <Frame>):
    // both get dims applied + routed through the optimizer. The 200x100 assertion is the regression
    // guard for literal <img> — it compiles to _jsx("img") and would bypass the components map
    // (so no dims, no /_next/image) without remarkLiteralImg. The external example.com image must
    // NOT be optimized.
    include: [
      "IMAGES_PAGE_MARKER",
      'width="120"', 'height="60"', // markdown ![]() image
      'width="200"', 'height="100"', // literal <img> in <Frame> — the regression guard
      "/_next/image",
      "https://example.com/remote.png",
    ],
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
    desc: "OpenAPI: GET endpoint page (params + response schema + tag-grouped nav)",
    // "Users" is the operations' OpenAPI tag → the sidebar groups them under it (not a flat
    // list). Capitalized so it matches the group header, not the "List users" page titles.
    include: ["GET", "/users", "limit", "Max users to return", ">Users<"],
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
  {
    slug: "mermaid",
    desc: "```mermaid renders as a <Mermaid> diagram, not a highlighted code block",
    // The client <Mermaid> SSRs an aria-label="Diagram" container (positive proof the fence was
    // transformed — a code block would instead emit Shiki markup). We can't assert the chart text
    // is absent: it's a client-component prop, so Next serializes it into the RSC flight payload
    // in the HTML. Instead, since this page has no other fenced code, the ABSENCE of "shiki" markup
    // is the clean signal the fence didn't fall through to the highlighter.
    include: ["MERMAID_PAGE_MARKER", 'aria-label="Diagram"'],
    exclude: ["shiki"],
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

// Control plane (SPEC §10, Layer-1 auth). Deliberately DB-free so it runs in CI with no
// Postgres: the app-host edge gate redirects before any DB query, and the auth pages are
// client-rendered. The control plane is URL-scoped and lives on the `app.` host at bare
// /:org/:site (rewritten onto the invisible /app mount). We exercise the gate by sending
// `Host: app.localhost`, which proves both the edge gate AND that bare /:org/:site never
// 500s/leaks docs to a signed-out visitor. Guards the (docs)/(auth) route split and the
// app-host routing from regressing.
const CONTROL_PLANE_CHECKS = [
  {
    host: "app.localhost",
    path: "/",
    desc: "unauthenticated app host / redirects to /login (edge gate)",
    redirectTo: "/login",
  },
  {
    host: "app.localhost",
    path: "/acme/docs",
    desc: "unauthenticated app host /:org/:site redirects to /login",
    redirectTo: "/login",
  },
  {
    host: "app.localhost",
    path: "/acme/connect",
    desc: "unauthenticated app host /:org/connect redirects to /login",
    redirectTo: "/login",
  },
  {
    host: "app.localhost",
    path: "/acme/docs/analytics",
    desc: "unauthenticated app host analytics redirects to /login",
    redirectTo: "/login",
  },
  {
    host: "app.localhost",
    path: "/acme/docs/automate/workflows",
    desc: "unauthenticated app host automate redirects to /login (SPEC §10.2)",
    redirectTo: "/login",
  },
  {
    host: "app.localhost",
    path: "/acme/docs/automate/agent",
    desc: "unauthenticated app host agent settings redirects to /login (SPEC §10.2)",
    redirectTo: "/login",
  },
  {
    // The live Activity feed's polling endpoint (SPEC §10.3) is a bare /:org/:site path, so
    // the edge gate must catch it like any dashboard page — an unauthenticated poll redirects
    // to /login, never leaks a tenant's deployment feed.
    host: "app.localhost",
    path: "/acme/docs/activity",
    desc: "unauthenticated app host activity feed redirects to /login (SPEC §10.3)",
    redirectTo: "/login",
  },
  {
    // The web editor (SPEC §9.2/§10) is a bare /:org/:site/editor path — the edge gate must
    // catch it like any dashboard page so an unauthenticated request never reaches the
    // authoring backend (draft buffer / git write path).
    host: "app.localhost",
    path: "/acme/docs/editor",
    desc: "unauthenticated app host editor redirects to /login (SPEC §9.2/§10)",
    redirectTo: "/login",
  },
  {
    // The editor's live preview (SPEC §9.2) renders the draft through the real renderer at
    // /preview/:org/:site. It's a bare app-host path like any dashboard page, so the edge gate
    // must catch it — an unauthenticated request must never render a tenant's draft content.
    host: "app.localhost",
    path: "/preview/acme/docs",
    desc: "unauthenticated app host editor preview redirects to /login (SPEC §9.2)",
    redirectTo: "/login",
  },
  {
    // The platform superadmin overview (SPEC §10.10) is a bare app-host path like any
    // dashboard page — the edge gate must bounce it signed-out. (The allowlist 404 for
    // signed-in non-admins needs a session + DB, so it's verified in-browser, not here.)
    host: "app.localhost",
    path: "/admin",
    desc: "unauthenticated app host /admin redirects to /login (SPEC §10.10)",
    redirectTo: "/login",
  },
  {
    path: "/login",
    desc: "login page renders in the platform theme (shell + gradient CTA)",
    // `db-glow` proves PlatformShell wraps it; `db-cta` proves the shared Button is used.
    // Guards the platform theme from regressing back to the old emerald/system look.
    include: ["Sign in to Papervine", "db-glow", "db-cta"],
  },
  {
    path: "/signup",
    desc: "signup page renders in the platform theme (shell + gradient CTA)",
    include: ["Create your Papervine account", "db-glow", "db-cta"],
  },
  {
    path: "/home",
    desc: "logged-out marketing apex shows Log in / Sign up, not Dashboard (session-aware nav, SPEC §2)",
    include: ['href="/login"', 'href="/signup"'],
    // Guards the session-aware swap: a signed-out visitor must never see the
    // Dashboard link (which only renders when getSession() resolves).
    exclude: ['href="/dashboard"'],
  },
  {
    path: "/pricing",
    desc: "marketing pricing page renders all three tiers, the Pro price, and the 90-day SSO/RBAC promo",
    // db-glow proves PlatformShell wraps it; the tier names + a matrix group prove the
    // table content rendered (not just the chrome). "399" + "billed annually" is Pro's
    // SSR'd annual price (ProPrice defaults to annual; React splits "$"/"399" with a
    // comment node, so we can't match "$399" literally); "Free for 90 days" is the
    // SSO/RBAC launch promo on the Pro card and in the matrix. Try for free → /signup.
    include: [
      "Pricing on",
      "db-glow",
      "Starter",
      "Pro",
      "Enterprise",
      "Customization",
      "399",
      "billed annually",
      "Free for 90 days",
      "Dashboard SSO",
      "Security before procurement",
      'href="/signup"',
    ],
  },
];

function log(msg) {
  process.stdout.write(msg + "\n");
}

// Raw GET that honors a custom Host header — undici's fetch silently drops `Host` (a
// forbidden header), so we can't use it to address the `app.` control-plane host. Manual
// redirect (no follow), so we can assert the gate's 30x → /login.
function rawGet(pathname, hostHeader) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: PORT,
        path: pathname,
        method: "GET",
        headers: hostHeader ? { host: hostHeader } : {},
      },
      (res) => {
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            location: res.headers.location ?? "",
            body,
          }),
        );
      },
    );
    req.on("error", reject);
    req.setTimeout(30_000, () => req.destroy(new Error("timeout")));
    req.end();
  });
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
    env: { ...process.env, PAPERVINE_CONTENT: FIXTURES },
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
    // Regression (PAPERVINE-3): this runs DB-free, so the connection-init tenant
    // lookup (getSiteByHost) must no-op rather than reject on ECONNREFUSED :5432.
    const mcpPost = (body) =>
      fetch(`${BASE}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify(body),
        // 120s: the FIRST request cold-compiles the /mcp route (+ MCP SDK) under
        // `next dev`, which blows a 30s budget on CI runners — the long-standing
        // "[mcp] request failed: aborted due to timeout" red. Healthy responses are
        // sub-second; this only tolerates compile latency, a real hang still fails.
        signal: AbortSignal.timeout(120_000),
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

    // llms.txt index (SPEC §9.1). Generated from the in-scope content source — here the
    // fixtures repo (DB-free, so the agent-analytics logging just no-ops). Assert it's
    // plain text listing real pages, so the generator can't regress to empty/HTML.
    {
      const before = failures.length;
      try {
        const res = await fetch(`${BASE}/llms.txt`, { signal: AbortSignal.timeout(30_000) });
        const body = await res.text();
        const ct = res.headers.get("content-type") ?? "";
        if (res.status !== 200) failures.push(`[llms.txt] expected 200, got ${res.status}`);
        if (!ct.includes("text/plain")) failures.push(`[llms.txt] expected text/plain, got "${ct}"`);
        for (const needle of ["# ", "## Docs", "(http", "/components"]) {
          if (!body.includes(needle)) failures.push(`[llms.txt] missing "${needle}"`);
        }
      } catch (e) {
        failures.push(`[llms.txt] request failed: ${e.message}`);
      }
      log(`  ${failures.length === before ? "✓" : "✗"} llms.txt index (200 text/plain + page links)`);
    }

    // GitHub push webhook signature gate (SPEC §3 auto-sync). DB-free: an unsigned /
    // wrongly-signed delivery must be rejected with 401 BEFORE the route parses the body
    // or touches the DB — so this runs without Postgres. The happy path (valid signature
    // → matching site syncs) needs the DB and is covered in the e2e suite.
    {
      const before = failures.length;
      try {
        const res = await fetch(`${BASE}/api/github/webhook`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-github-event": "push",
            "x-hub-signature-256": "sha256=deadbeef", // not a valid HMAC of the body
          },
          body: JSON.stringify({ ref: "refs/heads/main" }),
          signal: AbortSignal.timeout(30_000),
        });
        if (res.status !== 401) {
          failures.push(`[gh-webhook] expected 401 for a bad signature, got ${res.status}`);
        }
      } catch (e) {
        failures.push(`[gh-webhook] request failed: ${e.message}`);
      }
      log(`  ${failures.length === before ? "✓" : "✗"} github webhook rejects an unsigned delivery (401)`);
    }

    for (const check of CONTROL_PLANE_CHECKS) {
      const before = failures.length;
      const tag = `control-plane ${check.host ? `${check.host}` : ""}${check.path}`;
      try {
        // rawGet (not fetch) so a check can address the `app.` host via a real Host header.
        const res = await rawGet(check.path, check.host);
        if (check.redirectTo) {
          if (![301, 302, 303, 307, 308].includes(res.status) || !res.location.includes(check.redirectTo)) {
            failures.push(`[${tag}] expected redirect to ${check.redirectTo}, got ${res.status} → "${res.location}" — ${check.desc}`);
          }
        } else {
          if (res.status !== 200) {
            failures.push(`[${tag}] expected 200, got ${res.status} — ${check.desc}`);
          } else {
            for (const needle of check.include ?? []) {
              if (!res.body.includes(needle)) failures.push(`[${tag}] missing "${needle}" — ${check.desc}`);
            }
            for (const needle of check.exclude ?? []) {
              if (res.body.includes(needle)) failures.push(`[${tag}] should NOT contain "${needle}" — ${check.desc}`);
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
