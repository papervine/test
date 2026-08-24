// Put next-env.d.ts and tsconfig.json back to their canonical (dev/build) form after an e2e run.
//
// `next dev` EDITS both files to wire up its generated route types, pointing them at whatever
// distDir it was given: next-env.d.ts gets `import "./<distDir>/dev/types/routes.d.ts"`, and
// tsconfig.json gains `<distDir>` includes. Each harness uses its own NEXT_DIST_DIR, so an e2e
// run leaves them aimed at `.next-e2e` — a type snapshot frozen at that moment. `npm run
// typecheck` afterwards then validates every route against it, and a route added later fails with
// `params: Promise<unknown>` and nothing naming the cause. tsconfig `exclude` can't help: the
// import in next-env.d.ts is explicit, and an import always beats exclude. tsconfig.json is also
// tracked, so the edit shows up as a spurious repo diff.
//
// This CANONICALISES rather than restoring a backup, because the clean state is deterministic —
// point at `.next`, carry no `.next-*` includes. Two earlier attempts failed for instructive
// reasons, both verified rather than assumed:
//   • A globalTeardown hook runs BEFORE Playwright stops the webServer, so `next dev` rewrote the
//     files again on its way out (the teardown logged that it ran; the files were still wrong).
//   • Snapshotting at config load doesn't work either: Playwright imports the config more than
//     once, and a later import re-snapshotted the already-rewritten files.
// Hence: no state, run last, from scripts/e2e.mjs after Playwright's process is gone.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function rewrite(name, transform) {
  const file = join(ROOT, name);
  try {
    const before = readFileSync(file, "utf8");
    const after = transform(before);
    if (after !== before) {
      writeFileSync(file, after);
      console.log(`[e2e] restored ${name} (was pointing at a test distDir)`);
    }
  } catch {
    // Best-effort: failing to tidy a generated file must not fail the run.
  }
}

// `import "./.next-e2e/dev/types/routes.d.ts"` → `./.next/dev/types/...`
rewrite("next-env.d.ts", (s) => s.replace(/\.\/\.next-[a-z0-9]+\//g, "./.next/"));

// Drop any `".next-<harness>/…"` include lines, and heal a trailing comma if the last one went.
rewrite("tsconfig.json", (s) =>
  s
    .replace(/\n\s*"\.next-[a-z0-9]+\/(dev\/)?types\/\*\*\/\*\.ts",?/g, "")
    .replace(/",(\s*\n\s*)\]/, '"$1]'),
);
