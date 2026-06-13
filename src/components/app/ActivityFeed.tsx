"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import {
  ACTIVITY_EVENT,
  realtimeClientConfig,
  siteChannel,
} from "@/lib/realtime-client";
import {
  type ActivityRow,
  type FeedTarget,
  formatDurationMs,
  pollDelayMs,
  timeAgo,
  triggerDetail,
  triggerLabel,
} from "@/lib/overview";
import { formatElapsed } from "@/lib/format-elapsed";

// A `building` row younger than this is a live, in-flight sync → show the ticking counter;
// older is an orphaned/killed run (its serverless function died mid-sync, no catch to flip it
// to failed), so the counter is dropped rather than climbing forever. Mirrors the sync route's
// maxDuration=300s ceiling plus slack.
const SYNC_INFLIGHT_MS = 5 * 60_000;

// The Activity feed (SPEC §10.3), live. Seeded with the server-rendered rows (so first
// paint is unchanged and SSR stays the source of truth), then it swaps in fresh rows from
// the bare `/:org/:site/activity` endpoint — a webhook sync that starts while you're watching
// appears, and its `building` pill flips to Successful, with no reload.
//
// Two mechanisms drive that refetch, and the feed always works on the slower one alone:
//  • Poll (always on) — adaptive cadence (pollDelayMs): ~2.5s while a row is building, ~20s idle.
//  • Realtime (when configured) — subscribes to the site's private Pusher channel and refetches
//    the instant `runSync` publishes (sync start / finish), so the update is near-immediate
//    rather than up-to-2.5s late. If realtime is unconfigured or the socket drops, the poll
//    still carries the feed — realtime is a strict enhancement, never a dependency.
//
// Rows are uncontrolled `<details>` keyed by id, so React preserves each one's open/closed
// state across a refetch's re-render — an expanded row stays expanded when the list refreshes.
export function ActivityFeed({
  endpoint,
  target,
  initialRows,
  repoUrl,
  siteId,
}: {
  endpoint: string;
  target: FeedTarget;
  initialRows: ActivityRow[];
  repoUrl: string | null;
  siteId: string;
}) {
  const [rows, setRows] = useState(initialRows);
  // Set by the poll effect to "fetch now (and re-arm the timer)"; called by the realtime
  // effect when a Pusher event lands. A ref so the realtime effect needn't re-subscribe when
  // the poll effect re-creates the closure.
  const refetchNow = useRef<(() => void) | null>(null);

  // Re-seed when the server hands new rows (tab switch Live↔Previews re-renders the page,
  // which remounts with a new `endpoint` anyway, but a soft refresh can change props too).
  useEffect(() => setRows(initialRows), [initialRows]);

  // Live elapsed counter for in-flight syncs. While any row is `building`, tick a 1s clock so
  // its pill counts up ("Building 0:14") instead of sitting static — the active signal that a
  // sync is really running. `now` starts null so the server render and first client paint both
  // show the plain "Building" (no hydration mismatch); it's set after mount. The interval only
  // exists while something is building, so a quiet feed schedules no timer.
  const [now, setNow] = useState<number | null>(null);
  const hasBuilding = rows.some((d) => d.status === "building");
  useEffect(() => {
    if (!hasBuilding) {
      setNow(null);
      return;
    }
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasBuilding]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inflight: AbortController | null = null;

    const schedule = (ms: number) => {
      if (stopped) return;
      timer = setTimeout(tick, ms);
    };

    async function tick() {
      if (stopped) return;
      // Don't poll a backgrounded tab; re-check (and fetch immediately) when it's shown.
      if (typeof document !== "undefined" && document.hidden) {
        schedule(15_000);
        return;
      }
      inflight?.abort();
      inflight = new AbortController();
      try {
        const res = await fetch(endpoint, {
          signal: inflight.signal,
          cache: "no-store",
        });
        // Session expired in a long-idle tab, or a transient error: back off, keep trying.
        if (!res.ok) {
          schedule(res.status === 401 ? 60_000 : 30_000);
          return;
        }
        const data = (await res.json()) as { rows?: ActivityRow[] };
        if (stopped) return;
        const next = data.rows ?? [];
        setRows(next);
        schedule(pollDelayMs(next));
      } catch {
        if (!stopped) schedule(10_000);
      }
    }

    const onVisible = () => {
      if (stopped || document.hidden) return;
      if (timer) clearTimeout(timer);
      tick(); // refresh the moment the tab regains focus
    };

    // Realtime fires this to fetch immediately and re-arm the poll off the result.
    refetchNow.current = () => {
      if (stopped || (typeof document !== "undefined" && document.hidden)) return;
      if (timer) clearTimeout(timer);
      tick();
    };

    schedule(pollDelayMs(rows));
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      refetchNow.current = null;
      if (timer) clearTimeout(timer);
      inflight?.abort();
      document.removeEventListener("visibilitychange", onVisible);
    };
    // Only re-arm when the endpoint changes (the feed target). Reading `rows` here just
    // seeds the first delay; subsequent delays come from each fetch's own result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint]);

  // Realtime subscription (SPEC §10.3): when Pusher is configured, watch this site's private
  // channel and refetch the moment a sync starts/finishes — faster than waiting for the poll.
  // pusher-js is dynamically imported so it's out of the bundle (and never runs) when realtime
  // is off. Errors here are non-fatal: the poll above keeps the feed live regardless.
  useEffect(() => {
    const config = realtimeClientConfig();
    if (!config) return; // unconfigured → poll-only, exactly as before

    let cancelled = false;
    let cleanup: (() => void) | null = null;
    const channelName = siteChannel(siteId);

    import("pusher-js")
      .then(({ default: Pusher }) => {
        if (cancelled) return;
        const pusher = new Pusher(
          config.key,
          config.options as ConstructorParameters<typeof Pusher>[1],
        );
        const channel = pusher.subscribe(channelName);
        channel.bind(ACTIVITY_EVENT, () => refetchNow.current?.());
        cleanup = () => {
          channel.unbind_all();
          pusher.unsubscribe(channelName);
          pusher.disconnect();
        };
      })
      .catch(() => {
        /* pusher-js failed to load — stay on the poll fallback */
      });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [siteId]);

  if (rows.length === 0) {
    return (
      <div className="mt-3 rounded-xl border border-[rgba(var(--ink-rgb),0.06)] px-6 py-8 text-center text-sm text-[var(--muted)]">
        {target === "preview"
          ? "No preview deployments yet — branch previews will appear here."
          : "No activity yet — syncs will appear here once a repo is connected."}
      </div>
    );
  }

  return (
    <ul className="mt-3 divide-y divide-[rgba(var(--ink-rgb),0.06)] rounded-xl border border-[rgba(var(--ink-rgb),0.06)] bg-[rgba(var(--ink-rgb),0.02)]">
      {rows.map((d) => {
        // A `building` row younger than the in-flight ceiling is a live sync → tick a m:ss
        // counter; an older `building` row is a stale/orphaned run (its function was killed),
        // so it reads plain "Building". `now` is null until mount, so this is null server-side.
        const elapsed =
          d.status === "building" && now != null && now - d.createdAt < SYNC_INFLIGHT_MS
            ? formatElapsed(now - d.createdAt)
            : null;
        // Each row is an expander (<details>): the summary is the familiar row, the panel
        // holds sync metadata (duration, trigger, commit, error).
        return (
          <li key={d.id}>
          <details className="group">
            <summary className="flex cursor-pointer select-none items-start justify-between gap-4 px-4 py-3 [&::-webkit-details-marker]:hidden">
              <div className="flex min-w-0 items-start gap-3">
                <ChevronRight
                  aria-hidden
                  className="mt-1.5 size-3.5 shrink-0 text-[var(--muted)] transition-transform group-open:rotate-90"
                />
                <div className="min-w-0">
                  <p className="truncate text-sm text-[var(--fg)]">
                    {(d.commitMessage || "Sync").split("\n")[0]}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">
                    {triggerLabel(d.trigger, d.actorName)} · {timeAgo(d.createdAt)}
                    {(d.filesAdded > 0 || d.filesEdited > 0) &&
                      ` · ${d.filesAdded} added, ${d.filesEdited} edited`}
                  </p>
                </div>
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                  d.status === "successful"
                    ? "bg-emerald-500/15 text-emerald-400"
                    : d.status === "failed"
                      ? "bg-red-500/15 text-red-400"
                      : "bg-[rgba(var(--ink-rgb),0.06)] text-[var(--muted)]"
                }`}
              >
                {d.status === "successful" ? (
                  "Successful"
                ) : d.status === "failed" ? (
                  "Failed"
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    {elapsed && (
                      <span
                        aria-hidden
                        className="size-1.5 animate-pulse rounded-full bg-current"
                      />
                    )}
                    Building
                    {elapsed && <span className="tabular-nums">{elapsed}</span>}
                  </span>
                )}
              </span>
            </summary>
            {/* pl aligns with the summary text: px-4 + chevron 14 + gap 12. */}
            <div className="pb-3 pl-[42px] pr-4">
              <dl className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-xs sm:grid-cols-4">
                <div>
                  <dt className="text-[var(--muted)]">Duration</dt>
                  <dd className="mt-0.5 text-[var(--fg)] tabular-nums">
                    {d.durationMs != null
                      ? formatDurationMs(d.durationMs)
                      : (elapsed ?? "—")}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Trigger</dt>
                  <dd className="mt-0.5 text-[var(--fg)]">{triggerDetail(d.trigger)}</dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Commit</dt>
                  <dd className="mt-0.5 font-mono text-[var(--fg)]">
                    {d.commitSha && repoUrl ? (
                      <a
                        href={`${repoUrl}/commit/${d.commitSha}`}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:underline"
                      >
                        {d.commitSha.slice(0, 7)}
                      </a>
                    ) : (
                      (d.commitSha?.slice(0, 7) ?? "—")
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Files</dt>
                  <dd className="mt-0.5 text-[var(--fg)]">
                    {d.filesAdded + d.filesEdited > 0
                      ? `${d.filesAdded} added, ${d.filesEdited} edited`
                      : "—"}
                  </dd>
                </div>
              </dl>
              {/* Multi-line commit messages: the summary shows the first line; the body
                  lands here. */}
              {(d.commitMessage ?? "").includes("\n") && (
                <pre className="mt-2.5 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-[rgba(var(--ink-rgb),0.05)] p-3 text-xs leading-relaxed text-[var(--muted)]">
                  {(d.commitMessage ?? "").split("\n").slice(1).join("\n").trim()}
                </pre>
              )}
              {d.status === "failed" && d.error && (
                <div className="mt-2.5">
                  <p className="text-xs text-red-400/80">Why it failed</p>
                  <pre className="mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-[rgba(var(--ink-rgb),0.05)] p-3 text-xs leading-relaxed text-[var(--muted)]">
                    {d.error}
                  </pre>
                </div>
              )}
            </div>
          </details>
        </li>
        );
      })}
    </ul>
  );
}
