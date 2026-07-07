// @papervine/mdx-prosemirror — bidirectional MDX <-> ProseMirror conversion for the
// collaborative WYSIWYG editor. Pure and isomorphic (no React, no server-only).
//
//   mdxToProseMirror(body)  → ProseMirror doc JSON (for the Visual editor)
//   proseMirrorToMdx(doc)   → MDX string (for the Source view + persistence)
//
// The canonical collaborative value is the raw MDX text; the Visual editor is a projection.
// Known Papervine components become typed nodes; anything unmodelable (custom components,
// expressions, imports, raw HTML) is preserved verbatim so it never breaks and round-trips.

export { mdxToProseMirror } from "./src/to-prosemirror";
export { proseMirrorToMdx } from "./src/to-mdx";
export { splitFrontmatter, type SplitFrontmatter } from "./src/frontmatter";
export { textDiff, applyTextEdit, type TextEdit } from "./src/text-diff";
export { COMPONENTS } from "./src/components";
export type { PMDoc, PMNode, PMMark } from "./src/types";
