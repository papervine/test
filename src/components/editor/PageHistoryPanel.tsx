"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { History, X } from "lucide-react";
import {
  listPageVersionsAction,
  readPageVersionAction,
  restorePageVersionAction,
} from "@/lib/actions/authoring";
import {
  authorInitials,
  groupVersionsByDay,
  versionTime,
  type VersionRow,
} from "@/lib/page-history";

/**
 * Version history for the page being edited (SPEC §10.11).
 *
 * PUBLISH-level: one entry per publish that changed this page, newest first, grouped by day.
 * Not one per save — the editor autosaves, so save-level entries would be thousands of rows a
 * page and a list nobody could read.
 *
 * Selecting a version shows what it contained; Restore puts that content back into the DRAFT
 * rather than publishing it, so the author sees what they're about to ship and Publish stays the
 * only action that changes what readers see.
 */
export function PageHistoryPanel({
  org,
  site,
  branch,
  path,
  onClose,
  onRestored,
}: {
  org: string;
  site: string;
  branch: string;
  /** Docs-relative file path — what history is keyed by, not the URL slug. */
  path: string;
  onClose: () => void;
  /**
   * Told that the draft moved, not what it moved to: the shell re-reads it and pushes the result
   * through the pane's live binding, which broadcasts to collaborators like any other edit.
   * Handing the markdown straight to the pane would update this browser and no one else's.
   */
  onRestored: () => void;
}) {
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const load = useCallback(async () => {
    const res = await listPageVersionsAction(org, site, path);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setVersions(res.versions.map((v) => ({ ...v, publishedAt: new Date(v.at) })));
  }, [org, site, path]);

  // Reloads when the page changes: the panel stays open while you move between pages, and
  // showing the previous page's history would be worse than showing none.
  useEffect(() => {
    setVersions(null);
    setSelected(null);
    setPreview(null);
    setError(null);
    void load();
  }, [load]);

  function select(id: string) {
    setSelected(id);
    setPreview(null);
    startTransition(async () => {
      const res = await readPageVersionAction(org, site, id);
      if ("error" in res) setError(res.error);
      else setPreview(res.markdown);
    });
  }

  function restore(id: string) {
    startTransition(async () => {
      const res = await restorePageVersionAction(org, site, branch, path, id);
      if ("error" in res) setError(res.error);
      else {
        onRestored();
        onClose();
      }
    });
  }

  // Grouped against the CLIENT's clock, so "Today" means the reader's today.
  const groups = versions ? groupVersionsByDay(versions, new Date()) : [];

  return (
    <aside className="flex h-full w-full flex-col border-l border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
      <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <span className="flex items-center gap-2 text-sm font-medium">
          <History className="h-4 w-4" />
          Version history
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close version history"
          className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {error && (
          <p role="alert" className="px-1 py-2 text-sm text-red-500">
            {error}
          </p>
        )}

        {versions === null && !error && (
          <p className="px-1 py-2 text-sm text-neutral-500">Loading…</p>
        )}

        {/* An empty history is the ordinary state for a page that has never been published, so
            it says that rather than looking like a failure. */}
        {versions?.length === 0 && (
          <p className="px-1 py-2 text-sm text-neutral-500">
            No versions yet. A version is recorded each time this page is published.
          </p>
        )}

        {groups.map((group) => (
          <section key={group.label} className="mb-4">
            <h3 className="px-1 pb-2 text-xs font-medium text-neutral-500">{group.label}</h3>
            <ul className="space-y-1">
              {group.versions.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    onClick={() => select(v.id)}
                    aria-current={selected === v.id}
                    className={`w-full rounded-lg px-3 py-2 text-left transition-colors ${
                      selected === v.id
                        ? "bg-neutral-100 dark:bg-neutral-900"
                        : "hover:bg-neutral-50 dark:hover:bg-neutral-900/60"
                    }`}
                  >
                    <span className="flex items-center gap-2 text-sm">
                      {v.isCurrent ? "Latest published version" : "Published version"}
                      {v.isCurrent && (
                        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-500">
                          Current
                        </span>
                      )}
                    </span>
                    <span className="mt-1 flex items-center gap-2 text-xs text-neutral-500">
                      <span className="grid h-5 w-5 place-items-center rounded-full bg-neutral-200 text-[10px] font-medium text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200">
                        {authorInitials(v.authorName)}
                      </span>
                      {/* An automation publishes with no user behind it — say so rather than
                          leaving the line looking truncated. */}
                      {v.authorName ?? "Automation"} · {versionTime(v.publishedAt)}
                    </span>
                  </button>

                  {selected === v.id && (
                    <div className="mt-2 rounded-lg border border-neutral-200 p-2 dark:border-neutral-800">
                      <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words text-xs text-neutral-600 dark:text-neutral-400">
                        {pending && preview === null ? "Loading…" : preview}
                      </pre>
                      {!v.isCurrent && preview !== null && (
                        <button
                          type="button"
                          onClick={() => restore(v.id)}
                          disabled={pending}
                          className="mt-2 w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
                        >
                          {pending ? "Restoring…" : "Restore into draft"}
                        </button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </aside>
  );
}
