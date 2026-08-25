import { Extension } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { enclosingContainers } from "./containers";
import { nextSelectAllRange } from "./select-all-plan";

// Scoped Select All. ProseMirror's default `Mod-a` selects the whole document, which inside a
// component is almost never what you meant — and inside a <Tab> it's actively dangerous: the
// inactive panes are hidden (display:none, see TabsNodeView), so Select-All-then-type silently
// replaced content the user couldn't even see. So `Mod-a` now selects the enclosing component's
// content first and widens a level on each further press, falling through to the built-in
// whole-document behavior once there's nothing left to scope to.
//
// The widening rule lives in ./select-all-plan; this extension's only job is turning ProseMirror
// positions into the ranges that rule compares, and applying its answer.

export const SelectAllScope = Extension.create({
  name: "selectAllScope",

  addKeyboardShortcuts() {
    return {
      "Mod-a": ({ editor }) => {
        const { state } = editor;
        const { from, to } = state.selection;

        // Normalized ranges, innermost first. The normalization matters here beyond validity:
        // it's also what a previous press left behind, so comparing anything else would make
        // "press again to widen" never fire.
        const target = nextSelectAllRange(enclosingContainers(state), { from, to });
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
