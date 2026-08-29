"use client";

import { useCallback, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { VisualEditor } from "@/components/editor/VisualEditor";
import { SourcePane } from "./SourcePane";
import { DEMO_MDX } from "@/app/home/demo-page";
import type { EditorView } from "./DocsFrame";

/**
 * The real Visual editor, running on the marketing home with no backend at all.
 *
 * This is the actual `VisualEditor` the dashboard mounts — not a mock, not a screenshot. It can
 * run here because the editor and the MDX↔ProseMirror converter are pure client code: value in
 * = full MDX file, value out = full MDX file, no network calls of their own. What we skip is
 * everything ABOVE it (MdxEditorPane / EditorShell), which is where the server actions, the
 * draft persistence and the collab token minting live.
 *
 * `media={false}` is the one concession: `/image`, `/video` and `/embed` open a dialog that
 * lists and uploads into a site's object storage, and there is no site here. The prop drops
 * those three items from both menus rather than letting a visitor find a dead end.
 *
 * The source pane beside it is the whole argument: edits land as ordinary MDX you could commit.
 * It's a plain <pre> — the real editor's Source mode is a CodeMirror bound to a Yjs document,
 * which would drag collaboration machinery into a page that has no room for it.
 *
 * Chrome-less on purpose: DocsFrame supplies the browser frame, the filename and the mode
 * switch, so this renders only the panes.
 *
 * Both panes stay MOUNTED in every view and are hidden with CSS rather than unmounted. The
 * editor holds live ProseMirror state — caret, selection, undo history — and none of that
 * survives a remount, so switching to Markdown and back would silently discard the reader's
 * place in the document.
 */
export function EditorDemo({ view = "split" }: { view?: EditorView }) {
  const [value, setValue] = useState(DEMO_MDX);
  // What the editor emits for the UNTOUCHED document, captured from its own first emission.
  //
  // The editor re-seeds itself on mount and emits `frontmatter + proseMirrorToMdx(doc)`, so
  // `value` is never byte-identical to the raw constant even before anyone types — comparing
  // against the constant showed a Reset button on a document nobody had touched. Computing the
  // baseline by running the converter here doesn't work either: TipTap coerces the document to
  // its schema before we read it back, so the pure round trip is close but not equal. Taking the
  // editor's own first emission is the only baseline guaranteed to match.
  const baseline = useRef<string | null>(null);
  const onChange = useCallback((next: string) => {
    baseline.current ??= next;
    setValue(next);
  }, []);
  const dirty = baseline.current !== null && value !== baseline.current;

  // Only the split view is two columns; the single views give their pane the whole frame.
  return (
    <div className={`relative grid ${view === "split" ? "md:grid-cols-2" : "grid-cols-1"}`}>
      {dirty ? (
        <button
          type="button"
          onClick={() => setValue(DEMO_MDX)}
          className="db-ring absolute right-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface)] px-2.5 py-1 text-xs text-[var(--muted)] shadow-sm transition-colors hover:text-[var(--fg)]"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset
        </button>
      ) : null}

      {/* A definite height: .pv-visual is h-full, and a percentage height resolves against the
          nearest definite-height ancestor — without one the editor collapses (the same
          flex/percentage trap that gave the Card component full-page height). */}
      <div
        className={`h-[560px] overflow-y-auto px-5 py-4 lg:h-[660px] ${
          view === "markdown" ? "hidden" : ""
        }`}
      >
        <VisualEditor
          value={value}
          onChange={onChange}
          media={false}
          assetBase=""
          slug="quickstart"
          slugs={["quickstart"]}
          // Nothing to navigate to — one page, and no site behind it.
          onNavigate={() => {}}
        />
      </div>

      {/* Syntax-highlighted, and line-wrapped rather than scrolling sideways: a horizontal
          scrollbar hides the ends of the very lines the pane exists to show. */}
      <SourcePane
        value={value}
        className={`h-[560px] overflow-y-auto bg-[rgba(var(--ink-rgb),0.02)] text-[var(--muted)] lg:h-[660px] ${
          view === "markdown"
            ? "block"
            : view === "visual"
              ? // Editor only. This MUST be an unconditional `hidden`: an earlier cut fell through
                // to the split classes here, whose `md:block` put the Markdown back on screen —
                // stacked underneath the editor, since this view is a single column.
                "hidden"
              : // Split keeps the divider and, below md, drops to the editor alone — two panes in
                // a phone's width would leave neither readable.
                "hidden border-l border-[rgba(var(--ink-rgb),0.08)] md:block"
        }`}
      />
    </div>
  );
}
