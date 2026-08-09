"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, X, ListTree, FolderOpen, type LucideIcon } from "lucide-react";
import type { NavSection } from "@papervine/renderer/lib/nav";
import { NavTree } from "./NavTree";
import { FileTree } from "./FileTree";
import { BranchSwitcher } from "./BranchSwitcher";
import { PublishButton } from "./PublishButton";
import { EditorAgentPanel } from "./EditorAgentPanel";
import { MdxEditorPane, type Mode, type MdxEditorHandle } from "./MdxEditorPane";
import { PageSettings } from "./settings/PageSettings";
import { GroupSettings } from "./settings/GroupSettings";
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
  slugs,
  sessionBranches,
  initialSlug,
  initialPath,
  initialMarkdown,
  review = false,
  reviewBackHref,
}: {
  org: string;
  site: string;
  deployBranch: string;
  initialBranch: string;
  sections: NavSection[];
  slugs: string[];
  sessionBranches: string[];
  initialSlug: string;
  initialPath: string;
  initialMarkdown: string;
  // Automation-review mode (?review=1): show a review banner and auto-open the diff per page.
  review?: boolean;
  reviewBackHref?: string;
}) {
  const [branch, setBranch] = useState(initialBranch);
  const [slug, setSlug] = useState(initialSlug);
  const [path, setPath] = useState(initialPath);
  const [markdown, setMarkdown] = useState(initialMarkdown);
  // Visual ⇄ Source lives here, not in the pane: the pane is `key`ed by page so it remounts on
  // every nav click, and pane-local mode would snap back each time. Holding it in the shell makes
  // the chosen mode persist across page switches. Default Visual — clicking "Editor" lands you
  // straight in the rendered editor, like hosted docs platforms.
  const [mode, setMode] = useState<Mode>("visual");
  // Bump to force the editor pane to remount with fresh content (page switch / agent edit).
  const [docKey, setDocKey] = useState(0);
  // The editing-agent column is hidden by default — the editor opens on the page, more room for
  // writing — and revealed on demand via the "Ask agent" button or ⌘/Ctrl-I. We toggle visibility
  // (not mount) so the chat history survives a close→reopen.
  const [agentOpen, setAgentOpen] = useState(false);
  // Shortcut glyph: ⌘ on mac, Ctrl elsewhere. Defaults to ⌘ (matches SSR) and corrects on mount,
  // so there's no hydration mismatch.
  const [modKey, setModKey] = useState("⌘");
  // The Page/Group settings slide-over, opened from a nav-item cog.
  const [settings, setSettings] = useState<{ kind: "page" | "group"; key: string } | null>(null);
  // Left panel: "nav" (docs.json Navigation) ⇄ "files" (raw file tree), and whether it's shown.
  const [treeView, setTreeView] = useState<"nav" | "files">("nav");
  const [treeOpen, setTreeOpen] = useState(true);
  const [, start] = useTransition();
  const router = useRouter();
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
        // Changing pages closes any open settings panel (it targeted the old page/group).
        setSettings(null);
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

  // A revert/discard-all changed one or more paths — push the fresh content straight into the
  // live pane if (and only if) it's showing one of them. Deliberately NOT a docKey remount
  // (loadPage/refreshActive): that tears down and rejoins this page's collab room, which races
  // the "first client seeds an empty room" check in useCollabDoc against any peer who still has
  // the room open — their stale content would win, so the revert would never visibly land. Going
  // through the pane's live binding instead broadcasts as a normal incremental update, same as
  // any keystroke, so an already-open peer picks it up too.
  const applyExternalChange = useCallback(
    (paths: string[]) => {
      if (!paths.includes(path)) return;
      void (async () => {
        const res = await readDraftPageAction(org, site, branch, slug);
        if ("error" in res) return;
        setMarkdown(res.markdown);
        paneRef.current?.revertTo(res.markdown);
      })();
    },
    [org, site, branch, slug, path],
  );

  // Awaitable so the pane can flush a pending save before loading the preview iframe.
  const save = async (md: string): Promise<void> => {
    await saveDraftAction(org, site, branch, path, md);
  };

  // Settings panels. Flush the editor before opening page settings so it reads the latest draft.
  const openPageSettings = async (s: string) => {
    await paneRef.current?.flush();
    setSettings({ kind: "page", key: s });
  };
  const openGroupSettings = (g: string) => setSettings({ kind: "group", key: g });
  // A settings save changed frontmatter/docs.json — refresh the server-built nav to reflect it.
  const onSettingsSaved = () => router.refresh();
  const closeSettings = () => {
    const reloadActive = settings?.kind === "page" && settings.key === slug;
    setSettings(null);
    // Sync the editor with frontmatter edited in the panel (don't flush the stale editor buffer over it).
    if (reloadActive) loadPage(slug, branch, { flush: false });
  };

  // ⌘/Ctrl-I toggles the agent column (hosted docs platforms' "Ask agent" shortcut); set the glyph per OS.
  useEffect(() => {
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
    setModKey(isMac ? "⌘" : "Ctrl");
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "i" || e.key === "I")) {
        e.preventDefault();
        setAgentOpen((o) => !o);
      } else if (mod && e.key === "\\") {
        e.preventDefault(); // ⌘\ — hide/show the tree
        setTreeOpen((o) => !o);
      } else if (mod && e.shiftKey && (e.key === "f" || e.key === "F")) {
        e.preventDefault(); // ⌘⇧F — switch Navigation ⇄ Files (and reveal the tree if hidden)
        setTreeOpen(true);
        setTreeView((v) => (v === "nav" ? "files" : "nav"));
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

      {/* Col 2 — navigation / files tree (toggleable; hidden via ⌘\ or the header buttons) */}
      {treeOpen && (
        <aside className="w-64 shrink-0 overflow-y-auto border-r border-neutral-200 dark:border-neutral-800">
          <div className="px-3 py-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">
            {treeView === "nav" ? "Navigation" : "Files"}
          </div>
          {treeView === "nav" ? (
            <NavTree
              sections={sections}
              activeSlug={slug}
              onSelect={loadPage}
              onPageSettings={openPageSettings}
              onGroupSettings={openGroupSettings}
            />
          ) : (
            <FileTree slugs={slugs} activeSlug={slug} onSelect={loadPage} />
          )}
        </aside>
      )}

      {/* Cols 3–4 — editor */}
      <main className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
          <div className="flex min-w-0 items-center gap-2">
            {/* Left-panel view toggles: Navigation (list) / Files (folder). Clicking the active
                view hides the tree; clicking the other switches to it (and reveals it). */}
            <div className="flex shrink-0 items-center gap-1">
              <TreeButton
                icon={ListTree}
                label="Navigation"
                shortcuts={[["Switch tree", `${modKey}⇧F`], ["Hide tree", `${modKey}\\`]]}
                active={treeOpen && treeView === "nav"}
                onClick={() =>
                  treeOpen && treeView === "nav" ? setTreeOpen(false) : (setTreeOpen(true), setTreeView("nav"))
                }
              />
              <TreeButton
                icon={FolderOpen}
                label="Files"
                shortcuts={[["Switch tree", `${modKey}⇧F`], ["Hide tree", `${modKey}\\`]]}
                active={treeOpen && treeView === "files"}
                onClick={() =>
                  treeOpen && treeView === "files" ? setTreeOpen(false) : (setTreeOpen(true), setTreeView("files"))
                }
              />
            </div>
            <span className="h-5 w-px shrink-0 bg-neutral-300 dark:bg-neutral-700" />
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
          <PublishButton
            org={org}
            site={site}
            branch={branch}
            deployBranch={deployBranch}
            activePath={path}
            onBeforeRevert={(revertedPath) => {
              if (revertedPath === path) paneRef.current?.cancel();
            }}
            onBeforeDiscardAll={() => paneRef.current?.cancel()}
            onChanged={applyExternalChange}
          />
        </header>
        {review && (
          <div className="flex items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm">
            <span className="text-amber-700 dark:text-amber-300">
              Reviewing an automation change — the diff below shows what it edited on this page.
            </span>
            {reviewBackHref && (
              <a
                href={reviewBackHref}
                className="shrink-0 font-medium text-amber-700 underline underline-offset-2 dark:text-amber-300"
              >
                Back to run
              </a>
            )}
          </div>
        )}
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
            slugs={slugs}
            // A link clicked in the WYSIWYG loads that page here — the same path as a nav click,
            // so the pending edit is flushed and the tree/breadcrumb follow along.
            onNavigate={(next) => loadPage(next)}
            onSave={save}
            mode={mode}
            onModeChange={setMode}
            autoDiff={review}
          />
        </div>
        {/* Anchored inside <main> so the panel opens just right of the nav tree (over the editor),
            regardless of the agent column being open. */}
        {settings?.kind === "page" && (
          <PageSettings
            org={org}
            site={site}
            branch={branch}
            slug={settings.key}
            onSaved={onSettingsSaved}
            onClose={closeSettings}
          />
        )}
        {settings?.kind === "group" && (
          <GroupSettings
            org={org}
            site={site}
            branch={branch}
            group={settings.key}
            onSaved={onSettingsSaved}
            onClose={closeSettings}
          />
        )}
      </main>
    </div>
  );
}

/** A left-panel view toggle (Navigation / Files) with a titled, shortcut-annotated tooltip. */
function TreeButton({
  icon: Icon,
  label,
  shortcuts,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  shortcuts: [string, string][];
  active: boolean;
  onClick: () => void;
}) {
  return (
    <span className="pv-toolbtn-wrap">
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        onClick={onClick}
        className={`pv-toolbtn${active ? " is-active" : ""}`}
      >
        <Icon className="h-4 w-4" />
      </button>
      <span className="pv-tip pv-tip-menu" role="tooltip">
        <span className="pv-tip-title">{label}</span>
        {shortcuts.map(([name, keys]) => (
          <span key={name} className="pv-tip-row">
            <span>{name}</span>
            <kbd className="pv-tip-kbd">{keys}</kbd>
          </span>
        ))}
      </span>
    </span>
  );
}
