import { Extension, type Editor } from "@tiptap/core";
import { enclosingContainers } from "./containers";
import { edgeDeleteAction, guardsCodeGroupTab } from "./edge-guard-plan";

// Backspace stops at a component's edge instead of eating the component.
//
// ProseMirror's default Backspace at the start of a block joins it with what came before. Inside a
// `<Tab>` (or a Step, a Card, a Callout — anything with `defining: true` and block content) the
// thing that came before is the component's own opening, so emptying a tab and pressing Backspace
// once more lifted its content out and destroyed the tab. Deleting a component is something you do
// on purpose — a tab's ×, the block drag handle's menu — not something that happens because you
// held Backspace a beat too long.
//
// Delete gets the same treatment at the trailing edge: that one pulls the FOLLOWING block into the
// component, which is the same structural damage from the other side. Fixing only the reported
// half would leave the mirror-image bug in place.
//
// Returning true consumes the key. The rule is in ./edge-guard-plan; this only turns ProseMirror
// positions into what that rule compares, and owns the list of things Backspace can mean here.

/**
 * What Backspace means at a component's leading edge, where "join with what's above" isn't
 * available — in the order the editor would try them, innermost formatting first. Every one stays
 * INSIDE the component, which is the whole line the guard defends: strip the block, never escape
 * the box. If none applies there is genuinely nothing to do, and the key is swallowed.
 *
 * `can()` is the test rather than a hand-written "is this a list item?", because the editor is the
 * one that knows whether a given lift is legal at this exact position.
 */
const IN_CONTAINER_ACTIONS: { can: (editor: Editor) => boolean; run: (editor: Editor) => boolean }[] =
  [
    {
      can: (editor) => editor.can().liftListItem("listItem"),
      run: (editor) => editor.commands.liftListItem("listItem"),
    },
    {
      can: (editor) => editor.can().lift("blockquote"),
      run: (editor) => editor.commands.lift("blockquote"),
    },
    {
      // An emptied code block (or heading) is a block whose only remaining content IS its type, so
      // Backspace means "and not even that" — turned back into a paragraph in place, rather than
      // `clearNodes()`, which also lifts and would take it out of the component.
      can: (editor) => isEmptyTypedBlock(editor),
      run: (editor) => editor.commands.setNode("paragraph"),
    },
  ];

/** An empty textblock that isn't already a plain paragraph — the caret's own block. */
function isEmptyTypedBlock(editor: Editor): boolean {
  const { $from, empty } = editor.state.selection;
  const block = $from.parent;
  return empty && block.isTextblock && block.content.size === 0 && block.type.name !== "paragraph";
}

export const EdgeGuard = Extension.create({
  name: "componentEdgeGuard",

  addKeyboardShortcuts() {
    const guard = (direction: "backward" | "forward") => () => {
      const { state } = this.editor;
      const { from, to, $from, empty } = state.selection;
      // A <CodeGroup> tab first: this has to run BEFORE the in-container actions, whose "turn an
      // emptied code block into a paragraph" is exactly the tab-destroying move inside a group —
      // and before TipTap's CodeBlock shortcut and ProseMirror's join get their turn, which this
      // extension's position in the list guarantees. See guardsCodeGroupTab.
      const parent = $from.depth > 0 ? $from.node($from.depth - 1) : null;
      if (
        guardsCodeGroupTab(
          { type: $from.parent.type.name, parentType: parent?.type.name ?? null },
          { offset: $from.parentOffset, size: $from.parent.content.size, empty },
          direction,
        )
      ) {
        return true;
      }
      // Only Backspace has in-container actions, so only it goes looking — `can()` runs each
      // command against a throwaway transaction, which isn't worth doing on a key that can't use
      // the answer.
      const action =
        direction === "backward"
          ? IN_CONTAINER_ACTIONS.find((candidate) => candidate.can(this.editor))
          : undefined;
      const decision = edgeDeleteAction(
        enclosingContainers(state),
        { from, to },
        direction,
        action !== undefined,
      );
      if (decision === "allow") return false;
      if (decision === "handle" && action) return action.run(this.editor);
      return true;
    };
    return {
      Backspace: guard("backward"),
      Delete: guard("forward"),
    };
  },
});
