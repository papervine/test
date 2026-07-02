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

const DOCS = join(process.cwd(), "docs");

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

describe("docs corpus round-trips through the converter", () => {
  const files = walk(DOCS);

  it("finds a non-trivial corpus", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const file of files) {
    const rel = relative(DOCS, file);
    it(rel, () => {
      const body = splitFrontmatter(readFileSync(file, "utf8")).body;
      const once = norm(body); // never throws (invariant 1)
      const twice = norm(once);
      if (KNOWN_UNSTABLE.has(rel)) return; // documented edge — don't assert idempotency
      expect(twice).toBe(once); // invariant 2
    });
  }
});
