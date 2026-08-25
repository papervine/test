import { Extension } from "@tiptap/core";
import { enclosingContainers } from "./containers";
import { blocksEdgeDelete } from "./edge-guard-plan";

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
// positions into what that rule compares.
export const EdgeGuard = Extension.create({
  name: "componentEdgeGuard",

  addKeyboardShortcuts() {
    const guard = (direction: "backward" | "forward") => () => {
      const { state } = this.editor;
      const { from, to } = state.selection;
      return blocksEdgeDelete(enclosingContainers(state), { from, to }, direction);
    };
    return {
      Backspace: guard("backward"),
      Delete: guard("forward"),
    };
  },
});
