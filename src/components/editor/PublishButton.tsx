"use client";

import { useState, useTransition } from "react";
import { ChevronDown, GitPullRequest, GitCommit, FileText, RotateCcw, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  publishDraftAction,
  discardSessionAction,
  listSessionChangesAction,
  revertFileAction,
  type SessionChangeRow,
} from "@/lib/actions/authoring";
import { publishModeFor, publishMenuModes, type PublishMode } from "@/lib/publish-mode";

const STATUS_LABEL: Record<SessionChangeRow["status"], string> = {
  added: "Added",
  modified: "Modified",
  deleted: "Deleted",
};

// The Publish control. On a Git-backed site the primary action follows the selected branch,
// mirroring hosted docs platforms: on the deploy ("Default") branch Publish commits straight
// to it; on a working branch it opens a PR. On a Papervine-hosted site there's no repo, so
// Publish writes straight to the live site and the Git-only menu entries are omitted
// (SPEC §10.11). The caret menu opens a panel listing every changed file (status + a
// per-file revert icon on hover) plus a "Discard all changes" action — all three are
// draft-buffer features and behave identically on both kinds of site (SPEC §9.2).
export function PublishButton({
  org,
  site,
  branch,
  deployBranch,
  gitBacked,
  activePath,
  onBeforeRevert,
  onBeforeDiscardAll,
  onChanged,
}: {
  org: string;
  site: string;
  branch: string;
  deployBranch: string;
  // False for a Papervine-hosted site: no repo, so there are no commit/PR modes to offer.
  gitBacked: boolean;
  // The path currently open in the editor pane — used to cancel a pending autosave before
  // reverting that exact file, so a stale debounced save can't resurrect it (a real race:
  // the pane's save timer is independent of this panel's revert action).
  activePath: string;
  onBeforeRevert: (path: string) => void;
  onBeforeDiscardAll: () => void;
  // Called after a revert or a discard-all with the path(s) that changed, so the shell can
  // push fresh content into the open pane if (and only if) it's showing one of them.
  onChanged: (paths: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [changes, setChanges] = useState<SessionChangeRow[] | null>(null);
  const [loadingChanges, setLoadingChanges] = useState(false);

  // On the deploy branch, the natural publish is a direct commit (hosted docs platforms'
  // Publish on Default); on a working branch it's a PR into the deploy branch. A hosted site
  // publishes straight to live from any branch.
  const primaryMode = publishModeFor({ gitBacked, branch, deployBranch });
  const menuModes = publishMenuModes(gitBacked);

  const publish = (mode: PublishMode) =>
    start(async () => {
      setOpen(false);
      const res = await publishDraftAction(org, site, branch, mode);
      if (!res.ok) {
        // Errors linger a bit longer than the success default (more to read).
        toast.error(res.error, { duration: 8000 });
        return;
      }
      if (res.mode === "pr") toast.success(`Opened PR #${res.prNumber}`);
      else if (res.mode === "commit") toast.success(`Committed ${res.commitSha.slice(0, 7)} to the deploy branch`);
      else toast.success("Published your changes.");
    });

  const openPanel = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      setLoadingChanges(true);
      // Refetch every time the panel opens — nothing else in the editor keeps a live
      // change-count cache, and this is a rarely-opened dropdown.
      void listSessionChangesAction(org, site, branch).then((res) => {
        setChanges("error" in res ? [] : res);
        setLoadingChanges(false);
      });
    }
  };

  const revert = (path: string) =>
    start(async () => {
      onBeforeRevert(path);
      const res = await revertFileAction(org, site, branch, path);
      if ("error" in res || !res.ok) {
        toast.error("error" in res ? res.error : "Couldn't revert that file.");
        return;
      }
      setChanges((cur) => cur?.filter((c) => c.path !== path) ?? null);
      onChanged([path]);
    });

  const discardAll = () =>
    start(async () => {
      if (!window.confirm("Discard all uncommitted changes? This can't be undone.")) return;
      onBeforeDiscardAll();
      const affected = changes?.map((c) => c.path) ?? [];
      const res = await discardSessionAction(org, site, branch);
      if ("error" in res || !res.ok) {
        toast.error("error" in res ? res.error : "Couldn't discard changes.");
        return;
      }
      setChanges([]);
      setOpen(false);
      onChanged(affected);
    });

  const hasChanges = (changes?.length ?? 0) > 0;

  return (
    <div className="relative">
      <div className="flex">
        <button
          type="button"
          disabled={pending}
          onClick={() => publish(primaryMode)}
          className="flex items-center gap-1.5 rounded-l-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-60"
        >
          {primaryMode === "native" ? (
            <Upload className="h-4 w-4" />
          ) : primaryMode === "commit" ? (
            <GitCommit className="h-4 w-4" />
          ) : (
            <GitPullRequest className="h-4 w-4" />
          )}
          {pending ? "Publishing…" : "Publish"}
        </button>
        <button
          type="button"
          aria-label="Publish options"
          onClick={openPanel}
          className="rounded-r-md border-l border-green-700 bg-green-600 px-1.5 text-white hover:bg-green-500"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>
      {open && (
        <>
          <button className="fixed inset-0 z-10 cursor-default" aria-hidden onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-72 rounded-lg border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-800 dark:bg-neutral-950">
            <div className="px-2 py-1.5 text-xs font-medium text-neutral-500">
              {loadingChanges
                ? "Loading changes…"
                : hasChanges
                  ? `${changes!.length} file change${changes!.length === 1 ? "" : "s"}`
                  : "No changes yet"}
            </div>
            {hasChanges && (
              <div className="max-h-64 overflow-y-auto">
                {changes!.map((c) => (
                  <div
                    key={c.path}
                    className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-900"
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0 opacity-60" />
                    <span className="min-w-0 flex-1 truncate text-left text-sm">{c.title}</span>
                    <span className="shrink-0 text-xs text-neutral-400">{STATUS_LABEL[c.status]}</span>
                    <button
                      type="button"
                      aria-label={`Revert ${c.title}`}
                      disabled={pending}
                      onClick={() => revert(c.path)}
                      className="shrink-0 rounded p-1 text-neutral-500 opacity-0 hover:bg-neutral-200 group-hover:opacity-100 dark:hover:bg-neutral-700"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {hasChanges && (
              <>
                <div className="my-1 border-t border-neutral-200 dark:border-neutral-800" />
                <button
                  type="button"
                  disabled={pending}
                  onClick={discardAll}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-red-600 hover:bg-neutral-100 disabled:opacity-60 dark:text-red-400 dark:hover:bg-neutral-900"
                >
                  <RotateCcw className="h-4 w-4" /> Discard all changes
                </button>
              </>
            )}
            {/* Git mechanics only — a hosted site's single Publish action is the primary
                button, and offering these would fail at the server dispatch. */}
            {menuModes.includes("pr") && (
              <>
                <div className="my-1 border-t border-neutral-200 dark:border-neutral-800" />
                <button
                  type="button"
                  disabled={!hasChanges}
                  onClick={() => publish("pr")}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-900"
                >
                  <GitPullRequest className="h-4 w-4" /> Open a pull request
                </button>
              </>
            )}
            {menuModes.includes("commit") && (
              <button
                type="button"
                disabled={!hasChanges}
                onClick={() => publish("commit")}
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-900"
              >
                <GitCommit className="h-4 w-4" /> Commit to the deploy branch
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
