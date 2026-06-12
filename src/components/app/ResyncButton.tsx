"use client";

import { useState, useTransition } from "react";
import { resyncSite } from "@/lib/actions/sites";

// Manual re-pull of a site's repo into object storage (SPEC §3.1). The action refuses while
// a sync is already in flight (no queue/lock yet — SPEC §10.3), so surface that reason inline
// rather than silently no-op: the user just saw a "Building" row in the feed and needs to know
// why their click didn't start another.
export function ResyncButton({ siteId }: { siteId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        onClick={() =>
          start(async () => {
            const res = await resyncSite(siteId);
            setError(res?.ok ? null : (res?.error ?? null));
          })
        }
        disabled={pending}
        className="db-ring shrink-0 rounded-md px-2.5 py-1 text-xs text-[var(--muted)] hover:text-[var(--fg)] disabled:opacity-50"
      >
        {pending ? "Syncing…" : "Re-sync"}
      </button>
      {error && <span className="text-xs text-amber-400/90">{error}</span>}
    </>
  );
}
