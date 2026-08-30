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

/**
 * A code block that is a <CodeGroup> TAB, with the caret on the edge a delete key would cross.
 *
 * Every default for a code block at that edge destroys the tab, three different ways: TipTap's own
 * CodeBlock shortcut turns an EMPTY block into a paragraph (`clearNodes`), which stops being a tab
 * because the strip lists only code blocks; the in-container action below does the same at the
 * group's leading edge; and for a block with content, ProseMirror's join merges it with the
 * neighbouring block — two tabs become one. Inside a group the fence IS the tab, so none of those is
 * what Backspace or Delete means there. Removing a tab is the strip's ✕. Reported as "pressing
 * backspace while inside a code group destroys a tab".
 *
 * `offset`/`size` are the caret's offset in its block and the block's content size — pure numbers,
 * so the boundary is testable without ProseMirror.
 */
export function guardsCodeGroupTab(
  block: { type: string; parentType: string | null },
  caret: { offset: number; size: number; empty: boolean },
  direction: "backward" | "forward",
): boolean {
  if (!caret.empty) return false; // a real selection deletes real content, never structure
  if (block.type !== "codeBlock" || block.parentType !== "codeGroup") return false;
  return direction === "backward" ? caret.offset === 0 : caret.offset === caret.size;
}

/** What the key should do: run normally, be swallowed, or run the in-container action instead. */
export type EdgeDeleteAction = "allow" | "block" | "handle";

/**
 * The same rule, but with the case swallowing it whole got wrong.
 *
 * Guarding the edge is right; treating the edge as *"nothing can happen here"* is not. What
 * Backspace means at the start of a block is usually "strip this block's formatting" — lift the
 * list item, leave the quote, turn the emptied code fence back into a paragraph — and every one of
 * those stays INSIDE the component. Blocking them made a component the one place those blocks
 * couldn't be undone: first reported as "I'm not able to backspace out the first checkbox inside a
 * tab", then again for a code block and a blockquote that open one.
 *
 * `hasInContainerAction` is the editor's answer to "is there such a thing to do here" — it owns
 * that question, since only it knows which lift is legal at this position. Forward Delete gets no
 * equivalent: at the trailing edge it pulls the FOLLOWING block in whatever the cursor is nested
 * in, so there the answer is still nothing.
 */
export function edgeDeleteAction(
  containers: readonly SelRange[],
  selection: SelRange,
  direction: "backward" | "forward",
  hasInContainerAction: boolean,
): EdgeDeleteAction {
  if (!blocksEdgeDelete(containers, selection, direction)) return "allow";
  return direction === "backward" && hasInContainerAction ? "handle" : "block";
}
