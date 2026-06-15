"use client";

import { useEffect, useRef, useState } from "react";
import { Code2, Eye, RefreshCw } from "lucide-react";

type Mode = "source" | "preview";

/**
 * The editor pane (SPEC §9.2): a Source (raw MDX) ⇄ Preview toggle over ONE MDX string.
 *
 * Preview is THE REAL renderer — an <iframe> onto /app/preview/* which renders the current
 * draft through the same `<Mdx>` component, theme, and component map that ship to readers.
 * We deliberately do NOT use a WYSIWYG (MDXEditor): a second rendering engine only ever
 * approximates the MDX (custom components like <HeroCard> collapsed to opaque boxes). Editing
 * is in source; the preview is byte-faithful to publish.
 *
 * Edits debounce-save to the draft buffer via `onSave`; switching to Preview flushes any
 * pending save first so the iframe reflects the latest keystroke, then reloads.
 */
export function MdxEditorPane({
  initialMarkdown,
  path,
  org,
  site,
  branch,
  slug,
  onSave,
}: {
  initialMarkdown: string;
  path: string;
  org: string;
  site: string;
  branch: string;
  slug: string;
  onSave: (markdown: string) => void | Promise<void>;
  // `key`ed by the parent on page switch, so this remounts with fresh content per page.
}) {
  const [mode, setMode] = useState<Mode>("source");
  const [value, setValue] = useState(initialMarkdown);
  const [savedAt, setSavedAt] = useState<"idle" | "saving" | "saved">("idle");
  // Bump to force the preview iframe to reload (after a flush, or a manual refresh).
  const [previewNonce, setPreviewNonce] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track what's been persisted so a flush can skip a no-op save.
  const savedValue = useRef(initialMarkdown);

  const flush = async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (value !== savedValue.current) {
      setSavedAt("saving");
      await onSave(value);
      savedValue.current = value;
      setSavedAt("saved");
    }
  };

  const change = (md: string) => {
    setValue(md);
    if (md === savedValue.current) return;
    setSavedAt("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      await onSave(md);
      savedValue.current = md;
      setSavedAt("saved");
    }, 700);
  };
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const showPreview = async () => {
    await flush(); // persist the latest edit before the iframe reads the draft
    setPreviewNonce((n) => n + 1);
    setMode("preview");
  };

  const previewSrc = `/preview/${org}/${site}?branch=${encodeURIComponent(
    branch,
  )}&slug=${encodeURIComponent(slug)}&v=${previewNonce}`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-1.5 dark:border-neutral-800">
        <span className="truncate text-xs text-neutral-500">{path}</span>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-neutral-400">
            {savedAt === "saving" ? "Saving…" : savedAt === "saved" ? "Draft saved" : ""}
          </span>
          {mode === "preview" && (
            <button
              type="button"
              aria-label="Refresh preview"
              title="Refresh preview"
              onClick={() => void showPreview()}
              className="rounded p-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          )}
          <div className="flex overflow-hidden rounded-md border border-neutral-300 dark:border-neutral-700">
            <button
              type="button"
              aria-label="Source mode"
              aria-pressed={mode === "source"}
              onClick={() => setMode("source")}
              className={`px-2 py-1 ${mode === "source" ? "bg-neutral-200 dark:bg-neutral-700" : ""}`}
            >
              <Code2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Preview mode"
              aria-pressed={mode === "preview"}
              onClick={() => void showPreview()}
              className={`px-2 py-1 ${mode === "preview" ? "bg-neutral-200 dark:bg-neutral-700" : ""}`}
            >
              <Eye className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {mode === "source" ? (
          <textarea
            value={value}
            onChange={(e) => change(e.target.value)}
            spellCheck={false}
            className="h-full w-full resize-none bg-transparent p-4 font-mono text-sm leading-relaxed text-neutral-800 outline-none dark:text-neutral-200"
          />
        ) : (
          <iframe
            key={previewNonce}
            src={previewSrc}
            title="Live preview"
            className="h-full w-full border-0 bg-white"
          />
        )}
      </div>
    </div>
  );
}
