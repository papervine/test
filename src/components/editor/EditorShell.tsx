"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { ChevronRight, X } from "lucide-react";
import type { NavSection } from "@papervine/renderer/lib/nav";
import { NavTree } from "./NavTree";
import { BranchSwitcher } from "./BranchSwitcher";
import { PublishButton } from "./PublishButton";
import { EditorAgentPanel } from "./EditorAgentPanel";
import { MdxEditorPane, type Mode, type MdxEditorHandle } from "./MdxEditorPane";
import { readDraftPageAction, saveDraftAction } from "@/lib/actions/authoring";

// The 3-panel editor (SPEC §9.2/§10): editing-agent chat | navigation | multi-modal editor.
// Holds the active page + branch and routes every read/write through the authoring backend,
// so the human and the agent share one draft buffer.
export function EditorShell({
  org,
  site,
  deployBranch,
  initialBranch,
  sections,
  sessionBranches,
  initialSlug,
  initialPath,
  initialMarkdown,
}: {
  org: string;
  site: string;
  deployBranch: string;
  initialBranch: string;
  sections: NavSection[];
  sessionBranches: string[];
  initialSlug: string;
  initialPath: string;
  initialMarkdown: string;
}) {
  const [branch, setBranch] = useState(initialBranch);
  const [slug, setSlug] = useState(initialSlug);
  const [path, setPath] = useState(initialPath);
  const [markdown, setMarkdown] = useState(initialMarkdown);
  // Source ⇄ Preview lives here, not in the pane: the pane is `key`ed by page so it remounts
  // on every nav click, and pane-local mode would snap back to Source each time. Holding it in
  // the shell makes the chosen mode persist across page switches.
  const [mode, setMode] = useState<Mode>("source");
  // Bump to force the editor pane to remount with fresh content (page switch / agent edit).
  const [docKey, setDocKey] = useState(0);
  // The editing-agent column is hidden by default — the editor opens on the page, more room for
  // writing — and revealed on demand via the "Ask agent" button or ⌘/Ctrl-I. We toggle visibility
  // (not mount) so the chat history survives a close→reopen.
  const [agentOpen, setAgentOpen] = useState(false);
  // Shortcut glyph: ⌘ on mac, Ctrl elsewhere. Defaults to ⌘ (matches SSR) and corrects on mount,
  // so there's no hydration mismatch.
  const [modKey, setModKey] = useState("⌘");
  const [, start] = useTransition();
  // The pane remounts per page, so a keystroke still inside its 700ms autosave debounce would be
  // lost on a fast nav click. We flush it through this handle BEFORE a user-initiated switch.
  const paneRef = useRef<MdxEditorHandle>(null);

  const loadPage = useCallback(
    (nextSlug: string, nextBranch = branch, opts: { flush?: boolean } = {}) => {
      start(async () => {
        // Persist the current page's pending edit first — except on the agent-write refresh
        // (flush:false), where the agent's freshly-written draft must win, not the human's stale buffer.
        if (opts.flush ?? true) await paneRef.current?.flush();
        const res = await readDraftPageAction(org, site, nextBranch, nextSlug);
        if ("error" in res) return;
        setSlug(nextSlug);
        setPath(res.path);
        setMarkdown(res.markdown);
        setDocKey((k) => k + 1);
      });
    },
    [org, site, branch],
  );

  const switchBranch = (next: string) => {
    setBranch(next);
    loadPage(slug, next);
  };

  // The agent edited the draft — refetch the page the user is looking at. Don't flush: the agent's
  // write is the newer content; flushing the human's buffer here would clobber it.
  const refreshActive = useCallback(() => loadPage(slug, branch, { flush: false }), [loadPage, slug, branch]);

  // Awaitable so the pane can flush a pending save before loading the preview iframe.
  const save = async (md: string): Promise<void> => {
    await saveDraftAction(org, site, branch, path, md);
  };

  // ⌘/Ctrl-I toggles the agent column (the incumbent's "Ask agent" shortcut); set the glyph per OS.
  useEffect(() => {
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
    setModKey(isMac ? "⌘" : "Ctrl");
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "i" || e.key === "I")) {
        e.preventDefault();
        setAgentOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-[calc(100dvh-0px)] min-h-0 w-full">
      {/* Col 1 — editing agent (hidden until "Ask agent" / ⌘I; kept mounted so chat persists) */}
      <aside
        className={`${
          agentOpen ? "flex" : "hidden"
        } w-80 shrink-0 flex-col border-r border-neutral-200 dark:border-neutral-800`}
      >
        <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-3 text-sm font-semibold dark:border-neutral-800">
          <span>New chat</span>
          <button
            type="button"
            aria-label="Close agent"
            onClick={() => setAgentOpen(false)}
            className="rounded p-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <EditorAgentPanel org={org} site={site} branch={branch} onAgentWrite={refreshActive} />
      </aside>

      {/* Col 2 — navigation */}
      <aside className="w-64 shrink-0 overflow-y-auto border-r border-neutral-200 dark:border-neutral-800">
        <div className="px-3 py-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">Navigation</div>
        <NavTree sections={sections} activeSlug={slug} onSelect={loadPage} />
      </aside>

      {/* Cols 3–4 — editor */}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
          <div className="flex min-w-0 items-center gap-2">
            <BranchSwitcher
              org={org}
              site={site}
              branch={branch}
              deployBranch={deployBranch}
              sessionBranches={sessionBranches}
              onSwitch={switchBranch}
            />
            <button
              type="button"
              aria-pressed={agentOpen}
              onClick={() => setAgentOpen((o) => !o)}
              className={`flex shrink-0 items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm ${
                agentOpen
                  ? "border-neutral-400 bg-neutral-200 dark:border-neutral-600 dark:bg-neutral-700"
                  : "border-neutral-300 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
              }`}
            >
              Ask agent
              <kbd className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                {modKey}I
              </kbd>
            </button>
            <span className="flex min-w-0 items-center gap-1 text-sm text-neutral-500">
              <ChevronRight className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{slug || "index"}</span>
            </span>
          </div>
          <PublishButton org={org} site={site} branch={branch} deployBranch={deployBranch} />
        </header>
        <div className="min-h-0 flex-1">
          <MdxEditorPane
            key={docKey}
            ref={paneRef}
            initialMarkdown={markdown}
            path={path}
            org={org}
            site={site}
            branch={branch}
            slug={slug}
            onSave={save}
            mode={mode}
            onModeChange={setMode}
          />
        </div>
      </main>
    </div>
  );
}
