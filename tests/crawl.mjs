#!/usr/bin/env node
/**
 * Real-repo crawl tool. Boots the renderer against any docs repo and hits every
 * page, reporting how many fully render / degrade / 500. This is the manual probe
 * we used against papervine/starter and papervine/docs while building M1.
 *
 *   node tests/crawl.mjs /path/to/docs-repo [--sample N] [--port P]
 *
 * Exits non-zero if any page returns HTTP 500 — usable as an ad-hoc gate.
 */
import { spawn } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--"));
const sample = Number((args.find((a) => a.startsWith("--sample=")) || "").split("=")[1] || 0);
const port = Number((args.find((a) => a.startsWith("--port=")) || "").split("=")[1] || 4188);

if (!dir) {
  console.error("usage: node tests/crawl.mjs <docs-dir> [--sample=N] [--port=P]");
  process.exit(2);
}

const PKG_ROOT = process.cwd();
const CONTENT = path.resolve(dir);
// 127.0.0.1, not localhost: on some CI runners localhost resolves to IPv6 ::1
// first while `next dev` listens on IPv4, so requests never connect.
const BASE = `http://127.0.0.1:${port}`;
const nextBin = path.join(PKG_ROOT, "node_modules", ".bin", "next");

function slugsIn(root) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      if (e.startsWith(".") || e === "node_modules") continue;
      const full = path.join(d, e);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.mdx?$/.test(e)) {
        const rel = path.relative(root, full).replace(/\.mdx?$/, "");
        out.push(rel === "index" ? "" : rel);
      }
    }
  };
  walk(root);
  return out;
}

async function waitForReady(timeoutMs = 180_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (serverExited) throw new Error(`server exited early:\n${serverLog.slice(-2000)}`);
    try {
      if ((await fetch(BASE + "/", { signal: AbortSignal.timeout(15_000) })).status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`server not ready in ${timeoutMs}ms:\n${serverLog.slice(-2000)}`);
}

const all = slugsIn(CONTENT);
const slugs = sample > 0 ? all.filter((_, i) => i % Math.ceil(all.length / sample) === 0) : all;
console.log(`▶ crawling ${slugs.length}/${all.length} pages from ${CONTENT} on :${port}`);

const server = spawn(nextBin, ["dev", "-H", "0.0.0.0", "-p", String(port)], {
  cwd: PKG_ROOT,
  env: { ...process.env, PAPERVINE_CONTENT: CONTENT },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
let serverExited = false;
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));
server.on("exit", (code) => {
  serverExited = true;
  serverLog += `\n[server process exited with code ${code}]\n`;
});

let ok = 0,
  degraded = 0,
  err = 0;
const failed = [];
try {
  await waitForReady();
  for (const slug of slugs) {
    try {
      const res = await fetch(`${BASE}/${slug}`, { signal: AbortSignal.timeout(30_000) });
      const body = await res.text();
      if (res.status === 500) {
        err++;
        failed.push("/" + slug);
      } else if (body.includes("couldn") && body.includes("rendered")) degraded++;
      else ok++;
    } catch {
      err++;
      failed.push("/" + slug + " (request error)");
    }
  }
} finally {
  server.kill("SIGTERM");
}

console.log(`  fully rendered : ${ok}`);
console.log(`  graceful notice: ${degraded}`);
console.log(`  HTTP 500       : ${err}`);
if (failed.length) console.log("  failures:\n" + failed.map((f) => "    " + f).join("\n"));
process.exit(err > 0 ? 1 : 0);
