// Minimal single-range text diff — the collaboration keystone.
//
// The canonical collaborative value is `Y.Text("mdx")` (the whole raw MDX file). When a pane
// re-serializes the document after a local edit, we must NOT replace the whole Y.Text: that
// would wipe out a collaborator's concurrent edit and jump every remote cursor. Instead we
// compute the SMALLEST contiguous region that changed (strip the common prefix and suffix) and
// splice only that — `ytext.delete(index, remove); ytext.insert(index, insert)`. Untouched
// prefix/suffix (and thus distant edits + cursors) are preserved.
//
// Indices are UTF-16 code units — the same unit Y.Text.delete/insert count in — so a diff
// computed here applies verbatim to a Y.Text. A change that splits a surrogate pair is still
// correct: the halves land in `insert`/prefix and reconcatenate byte-exact.

export interface TextEdit {
  /** UTF-16 code-unit offset where the change begins. */
  index: number;
  /** Number of code units to delete starting at `index`. */
  remove: number;
  /** Replacement text to insert at `index`. */
  insert: string;
}

/**
 * The minimal single-range edit turning `oldStr` into `newStr`, or `null` if they're equal.
 * Contiguous-region diff (common-prefix/suffix): O(n) and exactly what a keystroke, paste, or
 * one-component reserialization produces. Not a multi-hunk diff — a single edit only ever
 * touches one region, and collapsing to one range keeps the Y.Text splice surgical.
 */
export function textDiff(oldStr: string, newStr: string): TextEdit | null {
  if (oldStr === newStr) return null;
  const oldLen = oldStr.length;
  const newLen = newStr.length;

  // Longest common prefix.
  const maxPrefix = Math.min(oldLen, newLen);
  let start = 0;
  while (start < maxPrefix && oldStr.charCodeAt(start) === newStr.charCodeAt(start)) start++;

  // Longest common suffix that doesn't overlap the prefix on either side.
  let oldEnd = oldLen;
  let newEnd = newLen;
  while (
    oldEnd > start &&
    newEnd > start &&
    oldStr.charCodeAt(oldEnd - 1) === newStr.charCodeAt(newEnd - 1)
  ) {
    oldEnd--;
    newEnd--;
  }

  return { index: start, remove: oldEnd - start, insert: newStr.slice(start, newEnd) };
}

/** Apply a TextEdit to a plain string — the inverse of textDiff, for tests and non-Yjs callers. */
export function applyTextEdit(str: string, edit: TextEdit): string {
  return str.slice(0, edit.index) + edit.insert + str.slice(edit.index + edit.remove);
}
