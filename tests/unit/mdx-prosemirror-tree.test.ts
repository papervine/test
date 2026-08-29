import { describe, expect, it } from "vitest";
import { mdxToProseMirror, proseMirrorToMdx } from "@papervine/mdx-prosemirror";

// <Tree> / <FileTree> — the first component whose children are MEMBER-EXPRESSION tags
// (`<Tree.Folder>`), which mdast reports as the literal name, so they're modeled like any other
// tag. Two shapes matter and neither is obvious: a file row is CHILDLESS (an atom, not a container
// with an empty paragraph in it), and the alias spelling has to come back exactly as written —
// a `<FileTree.File>` that round-trips as `<Tree.File>` is a diff in someone's repo.

const stable = (mdx: string) => {
  const once = proseMirrorToMdx(mdxToProseMirror(mdx) as never);
  const twice = proseMirrorToMdx(mdxToProseMirror(once) as never);
  expect(twice).toBe(once);
  return once;
};

describe("Tree", () => {
  const mdx = `<Tree>
  <Tree.Folder name="src" defaultOpen>
    <Tree.File name="index.ts" />
  </Tree.Folder>
  <Tree.File name="README.md" />
</Tree>
`;

  it("parses the rows as typed nodes, with a file as an atom", () => {
    const doc = mdxToProseMirror(mdx);
    const tree = doc.content[0];
    expect(tree.type).toBe("tree");
    expect(tree.content?.map((c) => c.type)).toEqual(["treeFolder", "treeFile"]);

    const folder = tree.content?.[0];
    expect(folder?.attrs).toMatchObject({ mdxName: "Tree.Folder", name: "src", defaultOpen: true });
    expect(folder?.content?.[0]).toMatchObject({
      type: "treeFile",
      attrs: { mdxName: "Tree.File", name: "index.ts" },
    });
    // An atom: no content at all, rather than the filler paragraph a container gets.
    expect(folder?.content?.[0].content).toBeUndefined();
  });

  it("round-trips stably", () => {
    // Not byte-for-byte: the mdast serializer puts a blank line after a row that HAS children,
    // the same normalization every other nested component gets. What has to hold is that it
    // settles — the second pass changes nothing — so editing a page can't keep re-diffing it.
    const once = stable(mdx);
    expect(once).toContain('<Tree.Folder name="src" defaultOpen>');
    expect(once).toContain('<Tree.File name="README.md" />');
  });

  it("keeps the alias spelling it was written with", () => {
    const aliased = `<FileTree>
  <FileTree.Folder name="app">
    <FileTree.File name="page.tsx" />
  </FileTree.Folder>
</FileTree>
`;
    const doc = mdxToProseMirror(aliased);
    expect(doc.content[0].attrs).toMatchObject({ mdxName: "FileTree" });
    expect(stable(aliased)).toBe(aliased);
  });

  it("preserves a file row that was written with children, rather than dropping them", () => {
    // `<Tree.File>` renders only its `name`, so children can't be modeled — and the passthrough
    // guarantee says preserve, never silently discard.
    const odd = "<Tree>\n  <Tree.File name=\"x\">surprise</Tree.File>\n</Tree>\n";
    // Written on one line with text in it, MDX parses it as INLINE JSX (the same shape that makes
    // a one-line `<Tab>` unswitchable), so it lands as an unknown inline atom inside a paragraph.
    // Either way the source survives verbatim, which is the guarantee that matters.
    const doc = mdxToProseMirror(odd);
    const row = doc.content[0].content?.[0];
    expect(row?.type).toBe("paragraph");
    expect(row?.content?.[0]).toMatchObject({ type: "mdxUnknownText" });
    expect(stable(odd)).toBe(odd);
  });
});
