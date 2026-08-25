// The decision layer behind scoped Select All in the Visual editor (see select-all-scope.ts),
// kept pure so the widening rule is unit-testable without ProseMirror.

export type SelRange = { from: number; to: number };

/**
 * Which range `Mod-A` should select next, given the component containers enclosing the cursor
 * (**innermost first**, each already normalized to the text range it would actually produce) and
 * the current selection. `null` means "nothing left to scope to" — let the editor's default
 * whole-document Select All run.
 *
 * The rule is: the innermost container that **strictly contains** the current selection. That
 * one rule covers all three cases:
 *
 * - caret sitting in a tab → the tab's own content (what you can see, not the whole page)
 * - press again, selection now equals that content → it no longer strictly contains, so we skip
 *   outward one level. Repeat and you eventually fall through to whole-document, so the default
 *   is never taken away — it just isn't the first thing that happens.
 * - a selection already dragged across two containers → neither one contains it, so we widen
 *   rather than silently *shrinking* the user's selection to whichever container the cursor
 *   happens to be anchored in.
 */
export function nextSelectAllRange(containers: SelRange[], current: SelRange): SelRange | null {
  for (const c of containers) {
    const contains = c.from <= current.from && c.to >= current.to;
    const identical = c.from === current.from && c.to === current.to;
    if (contains && !identical) return c;
  }
  return null;
}
