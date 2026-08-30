"use client";

import {
  useCallback,
  useEffect,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
// `History` is aliased because the bare name is the DOM's own global History type — an
// unimported <History /> resolves to that and fails as a JSX component rather than as a
// missing import, which reads like a React bug.
import {
  ChevronRight,
  Eye,
  X,
  ListTree,
  FolderOpen,
  History as HistoryIcon,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { unlistedPageSlugs } from "@/lib/nav-edit";
import { moveGroupInSections, moveLeafInSections } from "@/lib/nav-tree-move";
import type { NavSection } from "@papervine/renderer/lib/nav";
import { NavTree } from "./NavTree";
import { FileTree } from "./FileTree";
import { BranchSwitcher } from "./BranchSwitcher";
import { PreviewOverlay } from "./PreviewOverlay";
import { PublishButton } from "./PublishButton";
import { EditorAgentPanel } from "./EditorAgentPanel";
import { PageHistoryPanel } from "./PageHistoryPanel";
import { MdxEditorPane, type Mode, type MdxEditorHandle } from "./MdxEditorPane";
import { PageSettings } from "./settings/PageSettings";
import { GroupSettings } from "./settings/GroupSettings";
import {
  addPageToNavAction,
  createGroupAction,
  createPageAction,
  createTabAction,
  moveNavItemAction,
  readDraftPageAction,
  saveDraftAction,
} from "@/lib/actions/authoring";

// One drag, as the optimistic reducer sees it. Mirrors moveNavItemAction's input so the local
// and server halves of a move can't drift apart.
type NavMove =
  | { kind: "page"; from: { group: string; index: number }; to: { group: string; index: number } }
  | { kind: "group"; group: string; toIndex: number };

// The 3-panel editor (SPEC §9.2/§10): editing-agent chat | navigation | multi-modal editor.
// Holds the active page + branch and routes every read/write through the authoring backend,
// so the human and the agent share one draft buffer.
export function EditorShell({
  org,
  site,
  deployBranch,
  gitBacked,
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
  // Git-backed sites get the branch switcher and commit/PR publish modes; a
  // Papervine-hosted site has one branch and publishes straight to live (SPEC §10.11).
  gitBacked: boolean;
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
  const [previewOpen, setPreviewOpen] = useState(false);
  // Shortcut glyph: ⌘ on mac, Ctrl elsewhere. Defaults to ⌘ (matches SSR) and corrects on mount,
  // so there's no hydration mismatch.
  const [modKey, setModKey] = useState("⌘");
  // The Page/Group settings slide-over, opened from a nav-item cog.
  const [settings, setSettings] = useState<{ kind: "page" | "group"; key: string } | null>(null);
  // Left panel: "nav" (docs.json Navigation) ⇄ "files" (raw file tree), and whether it's shown.
  const [treeView, setTreeView] = useState<"nav" | "files">("nav");
  const [treeOpen, setTreeOpen] = useState(true);
  // Below lg the tree is an off-canvas drawer, not a column, so it needs its own open state:
  // `treeOpen` stays the desktop column's, defaulting open, which on a phone would mean the
  // drawer covers the editor on arrival. Two states rather than one viewport-aware state
  // because reading the viewport during render is a hydration mismatch — the split is done in
  // CSS, and the handlers below consult matchMedia (safe: they only run after hydration).
  const [mobileTreeOpen, setMobileTreeOpen] = useState(false);
  const [, start] = useTransition();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // The pane remounts per page, so a keystroke still inside its 700ms autosave debounce would be
  // lost on a fast nav click. We flush it through this handle BEFORE a user-initiated switch.
  const paneRef = useRef<MdxEditorHandle>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Keep the URL's ?slug=/&branch= in sync with whatever's actually open, so the current
  // page is linkable/bookmarkable and survives a refresh or browser back — EditorPage
  // already reads both on initial load, but nothing wrote them back on in-app navigation
  // (nav click, file tree, a followed link), so the URL stayed frozen at whatever page you
  // first opened. `replace` (not `push`): this mirrors state already updated client-side,
  // not a real navigation — every click adding a history entry would make back painful.
  // branch is omitted when it's just the deploy branch, matching the page's own default.
  const syncUrl = useCallback(
    (nextSlug: string, nextBranch: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("slug", nextSlug);
      if (nextBranch === deployBranch) params.delete("branch");
      else params.set("branch", nextBranch);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams, deployBranch],
  );

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
        syncUrl(nextSlug, nextBranch);
      });
    },
    [org, site, branch, syncUrl],
  );

  const isDesktop = () => window.matchMedia("(min-width: 1024px)").matches;

  // Picking a page from the tree. On mobile the tree is a drawer over the editor, so leaving it
  // open after a selection hides the very page you just chose.
  const selectPage = useCallback(
    (nextSlug: string) => {
      setMobileTreeOpen(false);
      loadPage(nextSlug);
    },
    [loadPage],
  );

  // Which "open" the header toggles depends on the breakpoint: the drawer below lg, the column
  // above it. Clicking the active view closes; clicking the other switches to it and reveals.
  const toggleTree = (view: "nav" | "files") => {
    if (isDesktop()) {
      if (treeOpen && treeView === view) setTreeOpen(false);
      else {
        setTreeOpen(true);
        setTreeView(view);
      }
    } else if (mobileTreeOpen && treeView === view) {
      setMobileTreeOpen(false);
    } else {
      setMobileTreeOpen(true);
      setTreeView(view);
    }
  };

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

  // Flush before showing the preview, for the same reason page settings does: the preview renders
  // the DRAFT, and autosave is debounced — without this the last thing you typed is the one thing
  // it doesn't show, which reads as the preview being broken.
  const openPreview = async () => {
    await paneRef.current?.flush();
    setPreviewOpen(true);
  };

  // Settings panels. Flush the editor before opening page settings so it reads the latest draft.
  const openPageSettings = async (s: string) => {
    await paneRef.current?.flush();
    setSettings({ kind: "page", key: s });
  };
  const openGroupSettings = (g: string) => setSettings({ kind: "group", key: g });
  // A settings save changed frontmatter/docs.json — refresh the server-built nav to reflect it.
  const onSettingsSaved = () => router.refresh();

  // ── The nav tree's "+" menu ──────────────────────────────────────────────────────────────
  // Pages that exist as files but aren't referenced anywhere in the navigation — what "Add
  // existing page" offers. Derived from the props the server already sends (`slugs` is every
  // page file, `sections` is the built nav), so no extra round trip. The comparison itself is
  // `unlistedPageSlugs`, which reconciles the two spellings of the index page.
  const navHrefs: string[] = [];
  const collectNav = (nodes: NavSection["nodes"]) => {
    for (const n of nodes) {
      if ("href" in n) navHrefs.push(n.href);
      else collectNav(n.items);
    }
  };
  sections.forEach((s) => collectNav(s.nodes));
  const unlistedSlugs = unlistedPageSlugs(slugs, navHrefs);

  const newPage = (group: string, title: string) =>
    start(async () => {
      const res = await createPageAction(org, site, branch, group, title);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      // Open what you just created — creating a page you then have to go find is busywork.
      router.refresh();
      loadPage(res.slug);
      toast.success(`Created ${res.slug}`);
    });

  const newGroup = (parent: string, name: string) =>
    start(async () => {
      const res = await createGroupAction(org, site, branch, name, parent);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      router.refresh();
      toast.success(`Added “${res.group}”`);
    });

  // Drag-and-drop reordering. Both write docs.json into the draft and re-read the server-built
  // tree; no optimistic local reorder, because the tree IS the server's view of docs.json and a
  // rejected move (someone else reordered it first) would otherwise leave the UI lying.
  const movePageTo = (
    from: { group: string; index: number },
    to: { group: string; index: number },
  ) =>
    start(async () => {
      applyMove({ kind: "page", from, to });
      try {
        const res = await moveNavItemAction(org, site, branch, { kind: "page", from, to });
        if ("error" in res) {
          toast.error(res.error);
          return; // the optimistic value drops when the transition ends → the row springs back
        }
        router.refresh();
      } catch {
        // A dropped connection rejects rather than returning {error}; without this the move
        // reverted but the failure surfaced as an unhandled rejection instead of a message.
        toast.error("Couldn't save that move — check your connection and try again.");
      }
    });

  const moveGroupTo = (group: string, toIndex: number) =>
    start(async () => {
      applyMove({ kind: "group", group, toIndex });
      try {
        const res = await moveNavItemAction(org, site, branch, { kind: "group", group, toIndex });
        if ("error" in res) {
          toast.error(res.error);
          return;
        }
        router.refresh();
      } catch {
        toast.error("Couldn't save that move — check your connection and try again.");
      }
    });

  // A drop has to land instantly. The tree is the SERVER's view of docs.json, so the naive
  // version awaited the write plus a router.refresh() — during which the row springs back to
  // where it came from and then jumps to its new home. useOptimistic shows the moved tree for
  // the duration of the transition; because `router.refresh()` runs INSIDE that transition,
  // React holds the optimistic value until the refreshed RSC payload has actually arrived, so
  // there's no gap where the old order flashes back.
  //
  // The revert is free and is why this is safe: if the action returns an error we simply don't
  // refresh, the transition ends, and the optimistic value is discarded — the row animates back
  // and the toast explains why. The UI can't end up disagreeing with docs.json.
  const [optimisticSections, applyMove] = useOptimistic(
    sections,
    (current: NavSection[], move: NavMove) =>
      move.kind === "page"
        ? moveLeafInSections(current, move.from, move.to)
        : moveGroupInSections(current, move.group, move.toIndex),
  );

  // Whether the site uses tabs at all — a section carries a `tab` label only when it does.
  // Drives the dialog's warning that adding a first tab restructures the navigation.
  const tabless = !sections.some((s) => s.tab);

  const newTab = (name: string) =>
    start(async () => {
      const res = await createTabAction(org, site, branch, name);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      router.refresh();
      toast.success(
        res.converted
          ? `Added “${res.tab}”. Your existing navigation is now the “Documentation” tab.`
          : `Added the “${res.tab}” tab`,
      );
    });

  const addExisting = (group: string, addSlug: string) =>
    start(async () => {
      const res = await addPageToNavAction(org, site, branch, group, addSlug);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      router.refresh();
      toast.success(`Added ${addSlug} to “${group}”`);
    });
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
      {/* Col 1 — editing agent (hidden until "Ask agent" / ⌘I; kept mounted so chat persists).
          Below lg it's a full-width sheet over the editor rather than a 320px column: a chat
          and an editor side by side don't both fit on a phone, and splitting them leaves
          neither usable. */}
      <aside
        className={`${
          agentOpen ? "fixed inset-0 z-40 flex w-full" : "hidden"
        } flex-col border-r border-neutral-200 bg-white lg:static lg:z-auto lg:w-80 lg:shrink-0 dark:border-neutral-800 dark:bg-neutral-950`}
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

      {/* Backdrop for the mobile tree drawer. Below lg the tree is `fixed`, so without this
          there's nothing to tap to dismiss it. `aria-hidden` (matching PublishButton's overlay):
          the drawer's own ✕ is the accessible dismiss, and labelling both made two identical
          "Close navigation" controls. */}
      {mobileTreeOpen && (
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          onClick={() => setMobileTreeOpen(false)}
          className="fixed inset-0 z-30 cursor-default bg-black/50 lg:hidden"
        />
      )}

      {/* Col 2 — navigation / files tree (toggleable; hidden via ⌘\ or the header buttons).
          Below lg it's an off-canvas DRAWER rather than a column: at 390px a 256px in-flow
          tree left the editor 38px wide — a single letter per line. Visibility is split by
          breakpoint so nothing has to detect the viewport during render (which would mean a
          hydration mismatch): `mobileTreeOpen` drives the drawer, `treeOpen` the column. */}
      {(treeOpen || mobileTreeOpen) && (
        <aside
          className={`overflow-y-auto border-r border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950 ${
            // Mobile: out of flow, so the editor keeps the full width underneath.
            mobileTreeOpen ? "fixed inset-y-0 left-0 z-40 w-[min(20rem,85vw)] shadow-2xl" : "hidden"
          } ${
            // Desktop: back to a plain column.
            treeOpen ? "lg:static lg:z-auto lg:block lg:w-64 lg:shadow-none" : "lg:hidden"
          }`}
        >
          <div className="flex items-center justify-between px-3 py-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
              {treeView === "nav" ? "Navigation" : "Files"}
            </span>
            {/* The drawer needs its own dismiss — the header toggle is behind the backdrop. */}
            <button
              type="button"
              aria-label="Close navigation"
              onClick={() => setMobileTreeOpen(false)}
              className="rounded p-1 text-neutral-500 hover:bg-neutral-100 lg:hidden dark:hover:bg-neutral-800"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {treeView === "nav" ? (
            <NavTree
              sections={optimisticSections}
              activeSlug={slug}
              onSelect={selectPage}
              onPageSettings={openPageSettings}
              onGroupSettings={openGroupSettings}
              onNewPage={newPage}
              onNewGroup={newGroup}
              onNewTab={newTab}
              onAddExisting={addExisting}
              onMovePage={movePageTo}
              onMoveGroup={moveGroupTo}
              unlistedSlugs={unlistedSlugs}
              tabless={tabless}
            />
          ) : (
            <FileTree slugs={slugs} activeSlug={slug} onSelect={selectPage} />
          )}
        </aside>
      )}

      {/* Cols 3–4 — editor */}
      <main className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-2 border-b border-neutral-200 px-2 py-2 lg:gap-3 lg:px-4 dark:border-neutral-800">
          <div className="flex min-w-0 items-center gap-2">
            {/* Left-panel view toggles: Navigation (list) / Files (folder). Clicking the active
                view hides the tree; clicking the other switches to it (and reveals it). */}
            <div className="flex shrink-0 items-center gap-1">
              <TreeButton
                icon={ListTree}
                label="Navigation"
                shortcuts={[["Switch tree", `${modKey}⇧F`], ["Hide tree", `${modKey}\\`]]}
                active={(treeOpen || mobileTreeOpen) && treeView === "nav"}
                onClick={() => toggleTree("nav")}
              />
              <TreeButton
                icon={FolderOpen}
                label="Files"
                shortcuts={[["Switch tree", `${modKey}⇧F`], ["Hide tree", `${modKey}\\`]]}
                active={(treeOpen || mobileTreeOpen) && treeView === "files"}
                onClick={() => toggleTree("files")}
              />
            </div>
            {/* A hosted site has exactly one branch, so a picker offering that single
                meaningless option is worse than no picker at all. */}
            {gitBacked && (
              <>
                <span className="h-5 w-px shrink-0 bg-neutral-300 dark:bg-neutral-700" />
                <BranchSwitcher
                  org={org}
                  site={site}
                  branch={branch}
                  deployBranch={deployBranch}
                  sessionBranches={sessionBranches}
                  onSwitch={switchBranch}
                />
              </>
            )}
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
              <kbd className="hidden rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] font-medium text-neutral-500 lg:inline dark:bg-neutral-800 dark:text-neutral-400">
                {modKey}I
              </kbd>
            </button>
            {/* The WHOLE site from the draft — navbar, tabs, sidebar, links between pages — as
                opposed to the in-pane Preview, which renders just the page you're editing.
                Opens over the editor rather than in a second tab: closing is one Escape, and a
                tab left open beside the editor went stale as you kept typing. */}
            <button
              type="button"
              onClick={openPreview}
              title="Preview the whole site as it will publish"
              className="flex shrink-0 items-center gap-1.5 rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
            >
              <Eye className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Preview</span>
            </button>
            {/* Publish-level history for the page in the pane. A plain button rather than an
                overflow menu: there is no other overflow item yet, and a "…" holding one thing
                hides it for no reason. */}
            <button
              type="button"
              onClick={() => setHistoryOpen((open) => !open)}
              aria-pressed={historyOpen}
              title="Version history for this page"
              className={`flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm ${
                historyOpen
                  ? "border-neutral-400 bg-neutral-100 dark:border-neutral-600 dark:bg-neutral-900"
                  : "border-neutral-300 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
              }`}
            >
              <HistoryIcon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">History</span>
            </button>
            <span className="hidden min-w-0 items-center gap-1 text-sm text-neutral-500 lg:flex">
              <ChevronRight className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{slug || "index"}</span>
            </span>
          </div>
          <PublishButton
            org={org}
            site={site}
            branch={branch}
            deployBranch={deployBranch}
            gitBacked={gitBacked}
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

      {/* Col 4 — version history, the mirror of the agent panel on the left. A 320px column from
          lg up, a full-width sheet below it: a history list and an editor side by side don't both
          fit on a phone, and splitting them leaves neither usable.

          Unmounted when closed, unlike the agent panel — it holds no conversation worth
          preserving, and a mounted-but-hidden panel would re-fetch on every page change. */}
      {historyOpen && (
        <aside className="fixed inset-0 z-40 flex w-full flex-col lg:static lg:z-auto lg:w-80 lg:shrink-0">
          <PageHistoryPanel
            org={org}
            site={site}
            branch={branch}
            path={path}
            onClose={() => setHistoryOpen(false)}
            // Signals that the draft moved; the shell re-reads it and pushes the result through
            // the pane's live binding, so collaborators see the restore too.
            onRestored={() => applyExternalChange([path])}
          />
        </aside>
      )}
      {previewOpen && (
        <PreviewOverlay
          org={org}
          site={site}
          slug={slug}
          onClose={() => setPreviewOpen(false)}
          // Close before summoning the agent: the composer lives in the editor's own layout, so
          // leaving the preview on top would put the agent behind an opaque full-screen frame.
          onAskAgent={() => {
            setPreviewOpen(false);
            setAgentOpen(true);
          }}
        />
      )}
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
