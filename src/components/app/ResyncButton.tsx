"use client";

import { useTransition } from "react";
import { resyncSite } from "@/lib/actions/sites";

// Manual re-pull of a site's repo into object storage (SPEC §3.1). Push-webhook
// auto-sync is the C-full follow-up.
export function ResyncButton({ siteId }: { siteId: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      onClick={() => start(() => resyncSite(siteId))}
      disabled={pending}
      className="shrink-0 rounded-md border border-neutral-700 px-2.5 py-1 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
    >
      {pending ? "Syncing…" : "Re-sync"}
    </button>
  );
}
