"use client";

import { useEffect, useRef, useState } from "react";
import { MonitorPlay, RefreshCw, Settings, Sparkles, X } from "lucide-react";
import { siteRoute } from "@/lib/dashboard-nav";

// The whole draft site, over the editor rather than in a second tab.
//
// It used to be `<a target="_blank">`, which put the preview in a window with no relationship to
// the editor: to get back you hunted for the tab, and the two drifted — the preview kept showing
// the draft as it was when you opened it while you carried on typing. An overlay makes going back
// a single Escape, and refreshing something you can do without leaving.
//
// The frame points at the same `/preview/{org}/{site}/site` route the tab used, so what's on
// screen is still the real renderer reading the real draft — not a second rendering path that
// could disagree with what publishes.
/**
 * Where the frame opens: the page being edited, not the site's front page.
 *
 * The index page is slug `""` and lives at the route's root — the same two-spellings problem the
 * nav tree has (`""` vs `"index"`), so it's normalized here rather than concatenated blindly.
 */
export function previewHref(org: string, site: string, slug: string): string {
  const clean = slug.replace(/^\/+/, "");
  const page = clean === "" || clean === "index" ? "" : `/${clean}`;
  return `/preview/${org}/${site}/site${page}`;
}

export function PreviewOverlay({
  org,
  site,
  slug,
  onClose,
  onAskAgent,
}: {
  org: string;
  site: string;
  /** The page being edited. Opening on the site's front page instead means every preview starts
   *  by making you navigate back to what you were just looking at. */
  slug: string;
  onClose: () => void;
  onAskAgent: () => void;
}) {
  // Bumping this remounts the iframe. Deliberately not `contentWindow.location.reload()`: that
  // works only while the frame is same-origin, and it would silently stop working if the preview
  // ever moved to the tenant host.
  const [reloadKey, setReloadKey] = useState(0);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // Focus the close button on open, so Escape isn't the only way out for a keyboard user and
    // the frame doesn't swallow the first Tab.
    closeRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="db-portal fixed inset-0 z-50 flex flex-col bg-[var(--bg)]"
      role="dialog"
      aria-modal="true"
      aria-label="Live preview"
    >
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-[rgba(var(--ink-rgb),0.1)] px-3">
        <span className="flex min-w-0 items-center gap-2 text-sm text-[var(--fg)]">
          <MonitorPlay className="h-4 w-4 shrink-0 text-[var(--muted)]" />
          <span className="truncate">Live preview</span>
        </span>

        <div className="flex shrink-0 items-center gap-1.5">
          <a
            href={siteRoute(org, site, "settings")}
            className="flex items-center gap-1.5 rounded-md border border-[rgba(var(--ink-rgb),0.15)] px-2.5 py-1.5 text-sm text-[var(--fg)] transition-colors hover:bg-[rgba(var(--ink-rgb),0.06)]"
          >
            <Settings className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Site settings</span>
          </a>
          <button
            type="button"
            onClick={onAskAgent}
            className="flex items-center gap-1.5 rounded-md border border-[rgba(var(--ink-rgb),0.15)] px-2.5 py-1.5 text-sm text-[var(--fg)] transition-colors hover:bg-[rgba(var(--ink-rgb),0.06)]"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Ask agent</span>
          </button>
          <button
            type="button"
            onClick={() => setReloadKey((n) => n + 1)}
            aria-label="Reload preview"
            title="Reload preview"
            className="rounded-md p-1.5 text-[var(--muted)] transition-colors hover:bg-[rgba(var(--ink-rgb),0.06)] hover:text-[var(--fg)]"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            type="button"
            ref={closeRef}
            onClick={onClose}
            aria-label="Close preview"
            title="Close preview (Esc)"
            className="rounded-md p-1.5 text-[var(--muted)] transition-colors hover:bg-[rgba(var(--ink-rgb),0.06)] hover:text-[var(--fg)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      <iframe
        key={reloadKey}
        src={previewHref(org, site, slug)}
        title="Live preview"
        className="min-h-0 flex-1 border-0 bg-white"
      />
    </div>
  );
}
