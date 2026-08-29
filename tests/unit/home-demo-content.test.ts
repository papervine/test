import { describe, it, expect } from "vitest";
import {
  COMPONENTS,
  mdxToProseMirror,
  proseMirrorToMdx,
  splitFrontmatter,
} from "@papervine/mdx-prosemirror";
import { DEMO_MDX } from "@/app/home/demo-page";

// The marketing home mounts the real Visual editor over DEMO_MDX with a live source pane beside
// it, and the demo's entire argument is "edit visually, it stays a real MDX file". A block the
// converter can't model would degrade to plain text (or reformat itself on first keystroke) in
// front of every visitor, on the page we most want to be convincing — and nothing else in CI
// opens this file. So it gets the same fidelity gate as the converter's own corpus.

const { frontmatter, body } = splitFrontmatter(DEMO_MDX);
const norm = (mdx: string) => proseMirrorToMdx(mdxToProseMirror(mdx));
// splitFrontmatter hands back everything after the closing `---`, so `body` opens with the
// blank line separating frontmatter from content. That's a separator, not a block, and the
// converter doesn't re-emit it — the only difference allowed here.
const content = body.replace(/^\n+/, "");

describe("the home demo page", () => {
  it("round-trips through the converter unchanged", () => {
    // Not merely idempotent (stable after one pass) — unchanged on the FIRST pass, which is
    // what the source pane shows the moment the editor mounts. Anything else and the demo
    // visibly reformats its own file in front of the visitor.
    expect(norm(content)).toBe(content);
  });

  it("stays stable on a second pass", () => {
    const once = norm(content);
    expect(norm(once)).toBe(once);
  });

  it("only uses components the editor can model", () => {
    // Anything outside COMPONENTS survives as a raw mdxUnknown node — correct behavior in a
    // customer's page, but in the demo it means a block the visitor can't actually edit.
    const used = [...content.matchAll(/<([A-Z][A-Za-z0-9]*)/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(0);
    for (const name of new Set(used)) {
      expect(COMPONENTS, `<${name}> is not in the converter's COMPONENTS map`).toHaveProperty(
        name,
      );
    }
  });

  it("carries frontmatter, which the editor holds aside and re-prepends", () => {
    expect(frontmatter).toContain("title:");
    expect(frontmatter).toContain("description:");
  });

  it("shows off the block kinds the demo is meant to demonstrate", () => {
    // A regression here means the demo still works but stops making its point.
    expect(content).toContain("<Note>");
    expect(content).toContain("<Tabs>");
    expect(content).toContain("<Steps>");
    expect(content).toMatch(/^\|.*\|$/m); // a table
    expect(content).toContain("```"); // a code fence
  });

  it("references no media, since the demo mounts with media disabled", () => {
    // media={false} removes /image, /video and /embed (no site, so no asset storage). Content
    // that used them would render a block the visitor can't recreate.
    expect(content).not.toMatch(/!\[[^\]]*\]\(/);
    expect(content).not.toMatch(/<(img|video|iframe|Frame)\b/i);
  });
});
