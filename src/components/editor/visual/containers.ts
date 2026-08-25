import { TextSelection, type EditorState } from "@tiptap/pm/state";
import { COMPONENTS } from "@papervine/mdx-prosemirror";
import type { SelRange } from "./select-all-plan";

// "Which component am I inside?" — shared by every behaviour that has to treat a component as a
// container with edges rather than as more document: scoped Select All, and the guard that stops
// Backspace from deleting the container you're editing inside.
//
// Our component nodes, from the same spec `nodes.ts` derives the schema from, so a component added
// there is covered here without a second list to keep in sync. Deliberately NOT lists,
// blockquotes or table cells: escaping those with Backspace is standard editor behaviour, and
// they carry no structure a reader would lose.
export const COMPONENT_NODES = new Set(Object.values(COMPONENTS).map((spec) => spec.node));

/**
 * The component containers enclosing the cursor, innermost first, as the text ranges they
 * actually span.
 *
 * Normalized through `TextSelection.between` rather than returned raw: a node's content
 * boundaries are not always valid text positions, so `start(depth)` is usually one short of the
 * first place a cursor can be. Comparing a cursor against the raw number would mean the edges
 * never match.
 */
export function enclosingContainers(state: EditorState): SelRange[] {
  const { $from } = state.selection;
  const out: SelRange[] = [];
  for (let depth = $from.depth; depth > 0; depth--) {
    if (!COMPONENT_NODES.has($from.node(depth).type.name)) continue;
    const sel = TextSelection.between(
      state.doc.resolve($from.start(depth)),
      state.doc.resolve($from.end(depth)),
    );
    out.push({ from: sel.from, to: sel.to });
  }
  return out;
}
