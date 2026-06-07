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
const BASE = `http://localhost:${PORT}`;
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
  const server = spawn(nextBin, ["dev", "-p", String(PORT)], {
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
  log(`\n✓ all ${CHECKS.length} fixture pages rendered without errors`);
  process.exit(0);
}

run();
