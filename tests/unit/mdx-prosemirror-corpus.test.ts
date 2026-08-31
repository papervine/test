import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";
import { mdxToProseMirror, proseMirrorToMdx, splitFrontmatter } from "@papervine/mdx-prosemirror";

// Corpus gate: round-trip every one of Papervine's own dogfooded docs/*.mdx through the
// converter. This is the real fidelity signal the plan calls for (SPEC: WYSIWYG editor) —
// curated fixtures prove the mechanism, real content finds the leaks. Two invariants:
//   1. NEVER crash — a converter that throws would 500 the editor.
//   2. IDEMPOTENT — norm(norm(x)) === norm(x) — except a documented allowlist of known
//      upstream edges. Any NEW drift fails the build, so fidelity can't silently regress.

// Three corpora, not one. `docs/` alone missed the raw-indent growth bug for weeks: the shape
// that triggered it (a multi-line unknown component inside an indented parent — the starter's
// <Tile> with a literal <img>) never appears in our own docs, but `examples/starter` is what
// EVERY start-from-scratch site is seeded with, and `tests/fixtures` is deliberately the ugly
// edge cases. The editor normalizes-and-saves whatever it opens, so any non-idempotent file in
// the starter grows on every open of a fresh site ("refreshing keeps saving a duplicate").
const ROOTS = ["docs", "examples/starter", "tests/fixtures"].map((d) => join(process.cwd(), d));

// Documented-exception mechanism for known non-idempotent files. Currently EMPTY: the whole
// corpus round-trips to a fixed point. Kept as a guard so a future upstream edge can be pinned
// with a written reason rather than silently weakening the assertion.
const KNOWN_UNSTABLE = new Set<string>([]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [".mdx", ".md"].includes(extname(p)) ? [p] : [];
  });
}

const norm = (mdx: string) => proseMirrorToMdx(mdxToProseMirror(mdx));

describe("docs + starter + fixtures corpora round-trip through the converter", () => {
  const files = ROOTS.flatMap(walk);

  it("finds a non-trivial corpus", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  for (const file of files) {
    const rel = relative(process.cwd(), file);
    it(rel, () => {
      const body = splitFrontmatter(readFileSync(file, "utf8")).body;
      const once = norm(body); // never throws (invariant 1)
      const twice = norm(once);
      if (KNOWN_UNSTABLE.has(rel)) return; // documented edge — don't assert idempotency
      expect(twice).toBe(once); // invariant 2
    });
  }
});
