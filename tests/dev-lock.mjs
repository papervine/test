// Detect an already-running `next dev` for this checkout, so a harness can refuse up front
// instead of failing obscurely a minute later.
//
// Next 16 keeps `.next/dev/lock` — {pid, port, hostname, appUrl, startedAt} — and allows only
// ONE dev server per directory (the lock is keyed on the directory, not the port). Every test
// harness here spawns its own `next dev`, so with `npm run dev` up the spawn is refused and
// the harness times out on "server did not become ready", which says nothing about the cause.
//
// Reuse is NOT an option, which is why this refuses rather than adopting the running server:
// each harness needs a different content root or database (`PAPERVINE_CONTENT=tests/fixtures`
// for smoke, the crawl target for crawl, the test DB for e2e). Pointing them at a dev server
// serving `content/` and the dev DB would make every assertion meaningless — or worse, pass.
//
// Each harness now runs in its OWN distDir (`.next-smoke` / `.next-crawl` / `.next-e2e`, via
// NEXT_DIST_DIR — see next.config.mjs), so it no longer collides with `npm run dev` at all.
// This check therefore looks at the harness's own lock, which leaves it guarding the case it's
// still right for: two runs of the SAME harness at once.
//
// Zero dependencies, matching the harnesses it serves.
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The live dev server for `root`, or null. A lock whose process is gone is treated as absent
 * (a killed server leaves the file behind), so a stale lock never blocks a test run.
 */
export function runningDevServer(root, distDir = ".next") {
  let lock;
  try {
    lock = JSON.parse(readFileSync(join(root, distDir, "dev", "lock"), "utf8"));
  } catch {
    return null; // no lock, unreadable, or malformed — nothing to report
  }
  if (!Number.isInteger(lock?.pid)) return null;
  try {
    process.kill(lock.pid, 0); // signal 0 = existence check, kills nothing
  } catch {
    return null; // stale lock from a killed server
  }
  return { pid: lock.pid, port: lock.port, appUrl: lock.appUrl };
}

/**
 * Refuse to start when a dev server holds this checkout, naming the cause and the fix.
 * `what` is the harness, for a message that says which thing can't run.
 */
export function requireNoDevServer(root, what, distDir = ".next") {
  const running = runningDevServer(root, distDir);
  if (!running) return;
  const where = running.appUrl ?? `port ${running.port}`;
  console.error(
    `\n✗ ${what} can't start: a dev server is already running for this checkout ` +
      `(pid ${running.pid}, ${where}).\n` +
      `  Next allows one dev server per directory, and this harness needs its own with a\n` +
      `  different content root / database — so it can't reuse yours.\n\n` +
      `  Stop it (Ctrl-C in that terminal, or \`kill ${running.pid}\`) and re-run.\n` +
      `  If nothing is actually running, \`npm run dev:fresh\` clears the stale state.\n`,
  );
  process.exit(1);
}
