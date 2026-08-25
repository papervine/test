import type { SelRange } from "./select-all-plan";

// The decision behind "Backspace at the start of a component does nothing", kept pure so the
// boundary arithmetic — the part that's off by one if you look at it wrong — is testable without
// ProseMirror.
//
// The behaviour it replaces: ProseMirror's default Backspace at the start of a block tries to join
// with what precedes it, and inside a component the thing that precedes it is the component's own
// opening. So emptying a tab and pressing Backspace once more didn't stop — it lifted the content
// out and took the tab with it. Components are deleted on purpose (a tab's ×, the block drag
// handle's menu), never by falling out of the top of one.

/**
 * Should this delete be swallowed?
 *
 * True when the cursor sits exactly on a component's leading edge (Backspace) or trailing edge
 * (Delete), with nothing selected — the two presses that would escape the container instead of
 * removing a character.
 *
 * `containers` are the enclosing component ranges, innermost first. Any match blocks: being at the
 * innermost container's edge is also being at the point where Backspace would escape it.
 */
export function blocksEdgeDelete(
  containers: readonly SelRange[],
  selection: SelRange,
  direction: "backward" | "forward",
): boolean {
  // A real selection is a real deletion — the user has picked something to remove, and removing a
  // component that way is deliberate.
  if (selection.from !== selection.to) return false;
  return containers.some((c) =>
    direction === "backward" ? selection.from === c.from : selection.from === c.to,
  );
}
