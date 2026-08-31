import type { Doc, Text } from "yjs";
import { textDiff } from "@papervine/mdx-prosemirror";

// The editor panes' view of the shared document: read the current MDX, push a new full-document
// string as a minimal splice, and hear about changes that didn't come from us. Extracted from
// useCollabDoc so it can be exercised headless over a real Y.Doc (tests/unit/collab-shared-text.ts)
// — the settle gate below is a correctness rule that needs a test, not a comment.
//
// THE SETTLE GATE (bug, 2026-08-30): a local write before the room has synced silently doubles the
// document. The panes render immediately — the Visual editor mounts with the server-rendered draft
// and its mount-time projection fires onChange straight away — but a freshly-opened room's Y.Text
// is still EMPTY at that moment, because the server's copy is a network hop away. So `textDiff("",
// wholeDraft)` inserts the entire document, and when the server state arrives moments later Yjs
// merges the two independent insertions: two copies, converged on both clients, autosaved into the
// draft. Alone in a room this is invisible (the room really is empty, so the insert is the seed) —
// it only shows when someone else is already in the document, which is why "refresh with two people
// in doubles the page" was the report.
//
// A pre-settle write is HELD, not applied — and then applied only if it's safe to. "Safe" has an
// exact meaning: a pane's write is a whole-document snapshot of the text it rendered from
// (`baseline`), so if the room settles holding exactly that baseline, the difference between them
// is nothing but what the user typed in the meantime — apply it and no keystroke is lost. If the
// room settles holding something ELSE, a peer is ahead of us: splicing our stale snapshot over
// their text would wipe their edits, so we drop it and let the pane adopt the settled text (which
// it already does on `ready`). Dropping unconditionally would have been simpler and still fixed the
// doubling, but it silently ate anything typed in the first few hundred milliseconds after open.

export interface SharedText {
  /** The current full MDX text. */
  getText(): string;
  /** Push a new full-document string as a minimal splice. A no-op until `settle()`. */
  setText(next: string): void;
  /**
   * Insert the page's initial content into a room that really is empty — the one write that
   * legitimately happens before `settle()`, decided by the caller's seed race (useCollabDoc).
   * Carries our own origin, so the seeding client doesn't hear its own seed back as a remote
   * change.
   */
  seed(text: string): void;
  /** Fire on changes NOT originating from our own `setText`. */
  onRemoteChange(fn: (text: string) => void): () => void;
  /**
   * The room has settled (server/peer state applied, and seeded if it was genuinely empty) — local
   * writes are safe from here on. Idempotent.
   *
   * `baseline` is the text the panes rendered from (the server-rendered draft). A write held from
   * before the room settled is applied only if the settled room text equals it — see the note at
   * the top of this file.
   */
  settle(baseline: string): void;
  /** Whether local writes are being applied yet — for assertions; no caller needs it. */
  isSettled(): boolean;
}

export function createSharedText(doc: Doc, ytext: Text): SharedText {
  // A per-instance origin tags OUR local splices, so the observer can tell our own echoes from
  // real remote/other-pane changes.
  const LOCAL = Symbol("pv-local");
  const remoteListeners = new Set<(text: string) => void>();
  let settled = false;
  // The newest whole-document string a pane tried to write before the room settled.
  let held: string | null = null;

  const splice = (next: string) => {
    const edit = textDiff(ytext.toString(), next);
    if (!edit) return;
    doc.transact(() => {
      if (edit.remove) ytext.delete(edit.index, edit.remove);
      if (edit.insert) ytext.insert(edit.index, edit.insert);
    }, LOCAL);
  };

  ytext.observe((_e, tr) => {
    if (tr.origin === LOCAL) return; // our own edit — the pane already has it
    const text = ytext.toString();
    for (const fn of remoteListeners) fn(text);
  });

  return {
    getText: () => ytext.toString(),

    setText: (next) => {
      if (!settled) {
        held = next; // see THE SETTLE GATE above — decided in settle()
        return;
      }
      splice(next);
    },

    seed: (text) => {
      if (!text) return;
      doc.transact(() => ytext.insert(0, text), LOCAL);
    },

    onRemoteChange: (fn) => {
      remoteListeners.add(fn);
      return () => remoteListeners.delete(fn);
    },

    settle: (baseline) => {
      const pending = held;
      held = null;
      settled = true;
      if (pending === null) return;
      // Apply what was typed before the room settled ONLY when the room came back holding exactly
      // the text the pane rendered from: then `pending` differs from it by the user's keystrokes
      // alone. Anything else means a peer is ahead — dropping is what protects their edits.
      if (ytext.toString() !== baseline) return;
      splice(pending);
      // Tell the panes to re-read. Their own state was set from whatever the text held when the
      // room settled, which is BEFORE this splice — so without this the typist's own view can sit
      // on the pre-settle projection while everyone else (and the draft) has the newer text. Safe
      // to route through the remote-change listeners: they mirror text into the pane and persist
      // it, and never write back into the shared doc, so there's no echo.
      const text = ytext.toString();
      for (const fn of remoteListeners) fn(text);
    },

    isSettled: () => settled,
  };
}
