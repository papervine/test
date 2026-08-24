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
import { readFileSync, writeFileSync } from "node:fs";
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

// `next dev` EDITS two files in the checkout to wire up its generated route types, and points
// them at whatever distDir it was given:
//   • next-env.d.ts — rewritten to `import "./<distDir>/dev/types/routes.d.ts"` (gitignored)
//   • tsconfig.json — gains `<distDir>/types/**` + `<distDir>/dev/types/**` includes (TRACKED)
//
// Each harness runs with its own NEXT_DIST_DIR, so running one leaves next-env.d.ts pointing at
// e.g. `./.next-crawl/dev/types/routes.d.ts` — a snapshot frozen at that moment. `npm run
// typecheck` then validates every route against those stale types, so a route added AFTERWARDS
// fails with `params: Promise<unknown>` and nothing pointing at the cause. tsconfig `exclude`
// can't save you: next-env.d.ts imports the file explicitly, and an import always beats exclude.
// And because tsconfig.json is tracked, a harness run also shows up as a spurious repo diff.
//
// So each harness snapshots both and restores them on the way out. Their generated contents are
// exactly what `npm run dev` writes back, so restoring loses nothing.
const GENERATED_BY_NEXT = ["next-env.d.ts", "tsconfig.json"];

export function protectNextEnv(root) {
  const saved = [];
  for (const name of GENERATED_BY_NEXT) {
    const file = join(root, name);
    try {
      saved.push([file, readFileSync(file, "utf8")]);
    } catch {
      // Absent (fresh checkout) — nothing to preserve for this one.
    }
  }
  let done = false;
  return () => {
    if (done) return;
    done = true;
    for (const [file, original] of saved) {
      try {
        if (readFileSync(file, "utf8") !== original) writeFileSync(file, original);
      } catch {
        // Best-effort: failing to restore a generated file must not fail the run.
      }
    }
  };
}
