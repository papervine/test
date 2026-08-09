"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useRealtimeRefresh } from "@/lib/use-site-realtime";

// Mounted (renders nothing) on the run list (?tab=runs) and run-detail pages so they update
// live as a run progresses — queued → running → succeeded/failed/review_needed — without a
// manual reload. Same realtime-first + poll-fallback pattern as BuildingPreview: instant via
// Pusher/Soketi when configured (src/trigger/automation-run.ts publishes on every status
// write), a plain interval otherwise. router.refresh() re-runs the page's own DB query, so
// the DB row stays the single source of truth — this is only ever a "go re-read it" nudge.
export function RunsLiveRefresh({ siteId }: { siteId: string }) {
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);
  useRealtimeRefresh(siteId, refresh);
  return null;
}
