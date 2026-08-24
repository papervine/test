// `npm run test:e2e` — Playwright, then put back the two files `next dev` rewrites.
//
// A wrapper rather than a shell one-liner in package.json for two reasons: extra args
// (`npm run test:e2e -- --grep x`) forward correctly instead of landing on a trailing `exit`,
// and the restore runs AFTER Playwright's process is gone. That last part is the point:
// Playwright shuts its webServer down after globalTeardown, so `next dev` rewrites
// next-env.d.ts + tsconfig.json on its way out and a teardown-time restore is undone moments
// later. See tests/e2e/config-guard.ts for what gets rewritten and why it matters.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const run = spawnSync("npx", ["playwright", "test", ...process.argv.slice(2)], {
  cwd: ROOT,
  stdio: "inherit",
});

// Always restore, pass or fail — a failed run repoints the files just as thoroughly.
spawnSync("node", [join(ROOT, "tests", "e2e", "restore-config.mjs")], {
  cwd: ROOT,
  stdio: "inherit",
});

process.exit(run.status ?? 1);
