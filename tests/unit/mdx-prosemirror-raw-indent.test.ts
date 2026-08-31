import { describe, expect, it } from "vitest";
import { mdxToProseMirror, proseMirrorToMdx } from "@papervine/mdx-prosemirror";

// A multi-line RAW atom (an unknown component, preserved verbatim) that sits INSIDE an indented
// context. The serializer's raw handler emits the stored value and remark-stringify prefixes the
// context's indentation onto every line — so a slice stored with its absolute indentation gained
// two spaces per continuation line on every parse→serialize pass. Not cosmetic: the editor saves
// what it normalizes, so a page holding this shape GREW on every open — reported as "refreshing
// this page keeps saving a duplicate of the data", via the starter's tiles page that every
// start-from-scratch site is seeded with. rawSlice now stores continuation lines relative to the
// node's first character, which makes re-indentation a fixed point.

const passes = (mdx: string, n: number): string[] => {
  const out: string[] = [];
  let cur = mdx;
  for (let i = 0; i < n; i++) {
    cur = proseMirrorToMdx(mdxToProseMirror(cur) as never);
    out.push(cur);
  }
  return out;
};

describe("multi-line raw atoms in indented contexts", () => {
  it("the starter's tile shape reaches a fixed point instead of growing", () => {
    // <Tile> is not a modeled component, so the whole element is a raw atom; the literal <img>
    // gives it a continuation line, and <Columns> supplies the indentation.
    const mdx =
      "<Columns cols={2}>\n" +
      '  <Tile title="Preview" href="/x">\n' +
      '    <img src="/images/preview.svg" alt="Preview" />\n' +
      "  </Tile>\n" +
      "</Columns>\n";
    const [p1, p2, p3] = passes(mdx, 3);
    expect(p2, "second pass must equal the first — the growth bug").toBe(p1);
    expect(p3).toBe(p2);
    // …and nothing was lost: the raw lines are all still present.
    expect(p1).toContain('<img src="/images/preview.svg" alt="Preview" />');
    expect(p1).toContain("</Tile>");
  });

  it("a multi-line raw atom at top level round-trips byte-exact", () => {
    const mdx =
      "<video controls>\n" +
      '  <source src="/videos/demo.mp4" type="video/mp4" />\n' +
      "</video>\n";
    const [p1, p2] = passes(mdx, 2);
    expect(p1).toBe(mdx);
    expect(p2).toBe(p1);
  });

  it("a deliberately deeper-indented inner line keeps its extra depth", () => {
    const mdx =
      "<Columns cols={2}>\n" +
      "  <Widget>\n" +
      "      deep line\n" + // 4 deeper than the atom's own column — must survive
      "  </Widget>\n" +
      "</Columns>\n";
    const [p1, p2] = passes(mdx, 2);
    expect(p2).toBe(p1);
    const widget = /<Widget>[\s\S]*?<\/Widget>/.exec(p1)?.[0] ?? "";
    const deep = widget.split("\n").find((l) => l.includes("deep line")) ?? "";
    const closer = widget.split("\n").find((l) => l.includes("</Widget>")) ?? "";
    expect(deep.length - deep.trimStart().length).toBeGreaterThan(
      closer.length - closer.trimStart().length,
    );
  });
});
