import { describe, it, expect } from "vitest";
import { mdxToProseMirror, proseMirrorToMdx, splitFrontmatter } from "@papervine/mdx-prosemirror";

// Regression for a real production corruption: an index page's draft ballooned to 843 KB — the whole
// file (frontmatter + body) concatenated to itself ~290 times. Root cause was a render loop driving
// the Visual editor's emit re-entrantly, but the load-bearing invariant that keeps such a loop from
// *growing* the document is that the emit round-trip is a FIXED POINT: splitting the frontmatter,
// projecting the body to ProseMirror, serializing back, and re-prepending the frontmatter must
// return the same string — so no number of extra emits can ever concatenate a second copy.

/** Exactly what VisualEditor does on every change: strip frontmatter, project body, re-prepend. */
function emitOnce(full: string): string {
  const { frontmatter, body } = splitFrontmatter(full);
  return frontmatter + proseMirrorToMdx(mdxToProseMirror(body));
}

const SAMPLE = `---
title: "Introduction"
description: "A page with beautiful defaults."
keywords: ["overview", "platform"]
---

# Heading

Some **bold** body text with a [link](https://example.com).

<Note>A known component with children.</Note>

<HeroCard filename="editor" title="Editor" href="/editor" />

export const Local = () => <div>raw JSX kept verbatim</div>
`;

describe("VisualEditor emit is a fixed point (never grows the document)", () => {
  it("settles after one emit and then never changes across repeated emits", () => {
    const settled = emitOnce(SAMPLE);
    // Idempotent from the settled form on: emit(emit(x)) === emit(x).
    expect(emitOnce(settled)).toBe(settled);
  });

  it("does not concatenate a copy no matter how many times it round-trips", () => {
    let cur = SAMPLE;
    const first = emitOnce(cur);
    for (let i = 0; i < 8; i++) cur = emitOnce(cur);
    // Length must stay bounded (~one copy), never climb toward N copies.
    expect(cur.length).toBeLessThanOrEqual(first.length + 2);
    expect(cur.length).toBeLessThan(SAMPLE.length * 2);
  });

  it("keeps the frontmatter block exactly once", () => {
    const out = emitOnce(emitOnce(SAMPLE));
    const fmBlocks = out.split(/^---$/m).length - 1; // opening + closing === 2 delimiters
    expect(fmBlocks).toBe(2);
    expect(out.match(/title: "Introduction"/g)?.length).toBe(1);
  });
});
