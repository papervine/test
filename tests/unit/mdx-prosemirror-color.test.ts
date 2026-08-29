import { describe, expect, it } from "vitest";
import { mdxToProseMirror, proseMirrorToMdx } from "@papervine/mdx-prosemirror";

// <Color> — swatches, modeled the same way the file tree is: member-expression rows whose whole
// content is attrs. The case worth pinning is the one the typed model deliberately REFUSES: a
// theme-aware `value={{ light, dark }}` is an expression, and an expression can't survive the
// round trip through typed attrs, so that swatch stays raw source instead of being flattened to
// one colour. Losing a dark-mode colour silently would be far worse than showing its MDX.

const stable = (mdx: string) => {
  const once = proseMirrorToMdx(mdxToProseMirror(mdx) as never);
  expect(proseMirrorToMdx(mdxToProseMirror(once) as never)).toBe(once);
  return once;
};

describe("Color", () => {
  it("parses swatches as atoms carrying their name and value", () => {
    const mdx = '<Color>\n  <Color.Item name="primary" value="#7c3aed" />\n</Color>\n';
    const doc = mdxToProseMirror(mdx);
    expect(doc.content[0].type).toBe("color");
    expect(doc.content[0].content?.[0]).toMatchObject({
      type: "colorItem",
      attrs: { mdxName: "Color.Item", name: "primary", value: "#7c3aed" },
    });
    expect(doc.content[0].content?.[0].content).toBeUndefined();
    expect(stable(mdx)).toBe(mdx);
  });

  it("keeps the variant and grouped rows", () => {
    const mdx =
      '<Color variant="table">\n' +
      '  <Color.Row title="Brand">\n' +
      '    <Color.Item name="primary" value="#7c3aed" />\n' +
      "  </Color.Row>\n" +
      "</Color>\n";
    const doc = mdxToProseMirror(mdx);
    expect(doc.content[0].attrs).toMatchObject({ variant: "table" });
    expect(doc.content[0].content?.[0]).toMatchObject({
      type: "colorRow",
      attrs: { title: "Brand" },
    });
    stable(mdx);
  });

  it("leaves a light/dark pair as raw source rather than flattening it", () => {
    const mdx =
      "<Color>\n" +
      '  <Color.Item name="bg" value={{ light: "#fff", dark: "#000" }} />\n' +
      "</Color>\n";
    const doc = mdxToProseMirror(mdx);
    expect(doc.content[0].content?.[0].type).toBe("mdxUnknownFlow");
    expect(stable(mdx)).toBe(mdx);
  });
});
