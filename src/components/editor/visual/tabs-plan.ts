// The decision layer behind the Visual editor's <Tabs> strip (see TabsNodeView), kept pure so
// the position arithmetic — the part that's easy to get subtly wrong and invisible until a tab
// lands one slot off — is unit-testable without ProseMirror or a browser.

/** A child <Tab>: where it starts in the document, and how much of the document it occupies. */
export type TabSlot = { pos: number; size: number };

/**
 * Where a tab's content is re-inserted when dragged from `from` to `to`, expressed in
 * PRE-deletion coordinates (the caller maps it through the delete step's mapping).
 *
 * Moving rightwards has to target the far side of the destination, because after the cut every
 * tab between the two has already shifted left by one slot; targeting `dest.pos` there drops the
 * tab BEFORE its destination instead of after it. Returns null when the move is a no-op or the
 * indices don't name real tabs.
 */
export function insertTargetForMove(tabs: TabSlot[], from: number, to: number): number | null {
  const src = tabs[from];
  const dest = tabs[to];
  if (!src || !dest || from === to) return null;
  return to > from ? dest.pos + dest.size : dest.pos;
}

/**
 * The tab to show after removing the active one. Only the active tab offers removal, so this is
 * always "the one that slid into its place", clamped to the end of a now-shorter strip.
 */
export function activeAfterRemove(active: number, count: number): number {
  return Math.max(0, Math.min(active, count - 2));
}

/**
 * Hides every pane in this <Tabs> except the one at `nthChild` (1-based).
 *
 * Every hop is spelled out, because each one is load-bearing:
 *
 * - `> [data-node-view-content-react] >` — TipTap inserts that element between a React node
 *   view's content hole and its child views (the same wrapper `.pv-cardgrid` has to flatten).
 * - `:is([data-pv-tab], :has(> [data-pv-tab]))` — and it wraps each child view in a
 *   `.react-renderer` div of its own, so the element to hide is the WRAPPER, not the pane. The
 *   pane's own marker is matched too, so the rule survives that wrapper going away.
 * - keeping it all to direct children stops the rule reaching into a nested <Tabs>, and matching
 *   only wrapped panes leaves stray non-Tab content inside the block visible rather than
 *   silently hidden.
 *
 * `:nth-child` counts every child of the content hole, so the caller passes the pane's index
 * among ALL children — not its index among the tabs.
 */
export function hiddenPaneRule(scopeId: string, nthChild: number): string {
  return (
    `[data-pv-tabs="${scopeId}"] > [data-node-view-content-react] > ` +
    `:is([data-pv-tab], :has(> [data-pv-tab])):not(:nth-child(${nthChild})) { display: none; }`
  );
}
