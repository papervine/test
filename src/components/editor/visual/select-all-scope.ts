import { Extension } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { COMPONENTS } from "@papervine/mdx-prosemirror";
import { nextSelectAllRange, type SelRange } from "./select-all-plan";

// Scoped Select All. ProseMirror's default `Mod-a` selects the whole document, which inside a
// component is almost never what you meant — and inside a <Tab> it's actively dangerous: the
// inactive panes are hidden (display:none, see TabsNodeView), so Select-All-then-type silently
// replaced content the user couldn't even see. So `Mod-a` now selects the enclosing component's
// content first and widens a level on each further press, falling through to the built-in
// whole-document behavior once there's nothing left to scope to.
//
// The widening rule lives in ./select-all-plan; this extension's only job is turning ProseMirror
// positions into the ranges that rule compares, and applying its answer.

// Our component nodes, from the same spec `nodes.ts` derives the schema from — so a component
// added there is scopable here without a second list to keep in sync. Deliberately NOT lists,
// blockquotes or table cells: selecting the whole document from inside those is the standard
// editor behavior, and nothing there is hidden from the reader.
const COMPONENT_NODES = new Set(Object.values(COMPONENTS).map((spec) => spec.node));

export const SelectAllScope = Extension.create({
  name: "selectAllScope",

  addKeyboardShortcuts() {
    return {
      "Mod-a": ({ editor }) => {
        const { state } = editor;
        const { $from, from, to } = state.selection;

        // Candidate containers, innermost first, each normalized through TextSelection.between:
        // a node's raw content boundaries are not always valid text positions, and the
        // normalized range is also what a previous press left behind — so comparing anything
        // else would make "press again to widen" never fire.
        const containers: SelRange[] = [];
        for (let depth = $from.depth; depth > 0; depth--) {
          if (!COMPONENT_NODES.has($from.node(depth).type.name)) continue;
          const sel = TextSelection.between(
            state.doc.resolve($from.start(depth)),
            state.doc.resolve($from.end(depth)),
          );
          containers.push({ from: sel.from, to: sel.to });
        }

        const target = nextSelectAllRange(containers, { from, to });
        // false → the built-in whole-document Select All runs, as it always did.
        if (!target) return false;

        return editor
          .chain()
          .command(({ tr, dispatch }) => {
            if (dispatch)
              tr.setSelection(
                TextSelection.between(tr.doc.resolve(target.from), tr.doc.resolve(target.to)),
              );
            return true;
          })
          .run();
      },
    };
  },
});
