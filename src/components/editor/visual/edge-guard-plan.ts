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

/** What the key should do: run normally, be swallowed, or unwrap the list item it's sitting in. */
export type EdgeDeleteAction = "allow" | "block" | "unwrap";

/**
 * The same rule, but with the case swallowing it whole got wrong.
 *
 * Guarding the edge is right; treating the edge as "nothing can happen here" is not. Backspace at
 * the start of a list item normally drops the list formatting — and that is a *delete that stays
 * inside the component*, so a list opening a tab was the one place a bullet or a checkbox could
 * never be removed. Reported as "I'm not able to backspace out the first checkbox inside a tab."
 *
 * `canUnwrap` is "the editor could lift this list item" — asked of the editor, since only it knows
 * whether the lift is legal here. Forward Delete gets no such case: at the trailing edge it pulls
 * the FOLLOWING block into the component whatever the cursor is nested in, so there the answer is
 * still nothing.
 */
export function edgeDeleteAction(
  containers: readonly SelRange[],
  selection: SelRange,
  direction: "backward" | "forward",
  canUnwrap: boolean,
): EdgeDeleteAction {
  if (!blocksEdgeDelete(containers, selection, direction)) return "allow";
  return direction === "backward" && canUnwrap ? "unwrap" : "block";
}
