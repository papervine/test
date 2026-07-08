"use client";

import { useEffect, useRef } from "react";
import * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";

// Source mode, the collaborative way. CodeMirror 6 bound DIRECTLY to the shared Y.Text via
// y-codemirror.next — not the value/onChange textarea. This is what the plan's "go for gold"
// buys us over the textarea:
//   • No caret jump. A remote insert before your cursor maps your selection through the CRDT,
//     so your cursor stays put instead of resetting — the textarea's core wart, gone.
//   • Remote cursors. yCollab renders every other editor's caret + selection in their presence
//     colour (from awareness), so you see where your collaborators are (Hocuspocus transport;
//     the same-browser BroadcastChannel fallback has no shared awareness, so just the caret fix).
//
// Persistence isn't wired here: CodeMirror writes to the Y.Text with its own transaction origin,
// so useCollabDoc's observer sees it as a change and the pane debounce-saves it — the same path a
// remote edit takes. So this component only needs the Y.Text + awareness.

// Match the platform's dark editor chrome: transparent, monospace, inherit the ink colour, no
// focus ring (the pane frames it). Remote-cursor colours come from yCollab's own inline styles.
const theme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "transparent", color: "inherit" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: "0.875rem",
    lineHeight: "1.6",
  },
  ".cm-content": { padding: "1rem", caretColor: "currentColor" },
  ".cm-cursor": { borderLeftColor: "currentColor" },
  ".cm-gutters": { display: "none" },
  ".cm-activeLine": { backgroundColor: "transparent" },
});

export function SourceEditor({ ytext, awareness }: { ytext: Y.Text; awareness: Awareness }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!host.current) return;
    // A Yjs-backed undo manager so ⌘Z only undoes THIS user's edits, not a collaborator's.
    const undoManager = new Y.UndoManager(ytext);
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: ytext.toString(), // must match the Y.Text; yCollab keeps them in sync thereafter
        extensions: [
          keymap.of([...yUndoManagerKeymap, ...defaultKeymap]),
          EditorView.lineWrapping,
          markdown(),
          yCollab(ytext, awareness, { undoManager }),
          theme,
        ],
      }),
    });
    return () => view.destroy();
  }, [ytext, awareness]);

  return <div ref={host} className="pv-cm h-full overflow-auto" />;
}
