"use client";

import { useEffect, useRef } from "react";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { syntaxHighlighting } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { markdownHighlight } from "@/components/editor/markdown-highlight";

// Transparent, monospace, inherits the surrounding ink — the pane's own frame supplies the
// chrome. Mirrors SourceEditor's theme so the demo and the real Source mode look related.
const theme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "transparent", color: "inherit" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: "0.75rem",
    lineHeight: "1.7",
  },
  ".cm-content": { padding: "1rem 1.25rem" },
  ".cm-gutters": { display: "none" },
  ".cm-activeLine": { backgroundColor: "transparent" },
  ".cm-line": { padding: "0" },
});

/**
 * The read-only MDX beside the visual editor, syntax-highlighted.
 *
 * A CodeMirror view rather than a `<pre>`: it gives real markdown/MDX tokenisation (component
 * tags, frontmatter, fences, emphasis) instead of a hand-rolled regex that would mis-colour the
 * first document it didn't anticipate. It's read-only — the visual editor is the input, this is
 * the proof of what that input produces.
 *
 * The document is replaced rather than the view rebuilt on every keystroke: recreating an
 * EditorView per change would throw away scroll position and make typing feel laggy.
 */
export function SourcePane({ value, className }: { value: string; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          EditorView.lineWrapping,
          EditorView.editable.of(false),
          markdown(),
          syntaxHighlighting(markdownHighlight),
          theme,
        ],
      }),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
    // Mount once: later `value` changes are dispatched below, not remounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const editor = view.current;
    if (!editor || editor.state.doc.toString() === value) return;
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: value },
    });
  }, [value]);

  return <div ref={host} data-testid="home-demo-source" className={className} />;
}
