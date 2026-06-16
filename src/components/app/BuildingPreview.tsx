"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useRealtimeRefresh } from "@/lib/use-site-realtime";

// Shown in place of the live SitePreview iframe while a site's FIRST sync is in flight (the
// connect flow returns immediately and runs the copy-to-storage in the background, so the
// user lands here on a site with no rendered content yet). Rather than iframe a not-yet-synced
// site (a 404), we play a little "assembling your docs" animation: a faux docs page that
// constructs itself piece-by-piece on a loop (keyframes in platform.css). It swaps to the real
// preview the moment the sync finishes — instantly via realtime, or via the poll fallback.
//
// Each "brick" is a wireframe bar; they share one infinite keyframe and differ only by
// animation-delay (`d`), so the build staggers nav → sidebar → title → text → cards and the
// stagger repeats every cycle.
function Brick({ className, d }: { className?: string; d: number }) {
  return <div className={`pv-brick ${className ?? ""}`} style={{ animationDelay: `${d}s` }} />;
}

const bar = "rounded-full bg-[rgba(var(--ink-rgb),0.09)]";
const grad = "rounded-full bg-gradient-to-r from-[var(--blue)] to-[var(--violet)]";

export function BuildingPreview({ name, siteId }: { name: string; siteId: string }) {
  const router = useRouter();

  // Swap the page to the live preview as soon as the background sync promotes the site to
  // 'live': realtime fires the refresh the instant runSync publishes; the poll backstops it if
  // realtime is off or the socket drops. Once live, this component unmounts (its subscription +
  // timer are cleaned up); until then a refresh just re-renders the same building state.
  const refresh = useCallback(() => router.refresh(), [router]);
  // Realtime gives the instant swap on a normal (slow) build, where the subscription is ready
  // long before the sync finishes. But a *fast* first sync can finish during the redirect —
  // before the channel's auth handshake completes — so realtime misses that event; keep the
  // safety poll brisk (the building state is short-lived) so the swap is still prompt.
  useRealtimeRefresh(siteId, refresh, { livePollMs: 4000, fallbackPollMs: 4000 });

  return (
    <div>
      <div
        aria-label={`${name} is building`}
        role="img"
        className="relative aspect-[16/10] overflow-hidden rounded-2xl border border-[rgba(var(--ink-rgb),0.08)] bg-[rgba(var(--ink-rgb),0.02)]"
      >
        {/* Blueprint grid — the build "canvas". */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(rgba(var(--ink-rgb),0.06) 1px, transparent 1px)",
            backgroundSize: "14px 14px",
          }}
        />

        {/* The faux docs page that assembles itself. */}
        <div className="absolute inset-0 flex flex-col p-3.5">
          {/* Top bar: logo · nav · search */}
          <div className="flex items-center gap-1.5">
            <Brick className="size-3 !rounded-md bg-gradient-to-br from-[var(--blue)] to-[var(--violet)]" d={0} />
            <Brick className={`h-1.5 w-7 ${bar}`} d={0.06} />
            <Brick className={`h-1.5 w-5 ${bar}`} d={0.12} />
            <Brick className={`h-1.5 w-6 ${bar}`} d={0.18} />
            <div className="flex-1" />
            <Brick className={`h-3 w-12 rounded-full bg-[rgba(var(--ink-rgb),0.05)] ring-1 ring-[rgba(var(--ink-rgb),0.08)]`} d={0.24} />
          </div>

          <div className="mt-3 flex flex-1 gap-3">
            {/* Sidebar */}
            <div className="w-[26%] space-y-1.5">
              <Brick className={`h-1.5 w-10 ${grad} opacity-70`} d={0.3} />
              <Brick className={`mt-2.5 h-1.5 w-full ${grad}`} d={0.36} />
              <Brick className={`h-1.5 w-4/5 ${bar}`} d={0.42} />
              <Brick className={`h-1.5 w-11/12 ${bar}`} d={0.48} />
              <Brick className={`h-1.5 w-3/5 ${bar}`} d={0.54} />
            </div>

            {/* Main content */}
            <div className="flex-1 space-y-2">
              <Brick className={`h-2.5 w-3/5 ${grad}`} d={0.34} />
              <Brick className={`h-1.5 w-2/5 ${bar}`} d={0.44} />
              <div className="h-1" />
              <Brick className={`h-1.5 w-full ${bar}`} d={0.52} />
              <Brick className={`h-1.5 w-[94%] ${bar}`} d={0.58} />
              <Brick className={`h-1.5 w-[68%] ${bar}`} d={0.64} />
              {/* Card grid */}
              <div className="grid grid-cols-2 gap-2 pt-1.5">
                <Brick
                  className="!rounded-lg h-9 border border-[rgba(var(--ink-rgb),0.08)] bg-[rgba(var(--ink-rgb),0.03)]"
                  d={0.72}
                />
                <Brick
                  className="!rounded-lg h-9 border border-[rgba(var(--ink-rgb),0.08)] bg-[rgba(var(--ink-rgb),0.03)]"
                  d={0.8}
                />
              </div>
            </div>
          </div>

          {/* Sheen sweep across the built page. */}
          <div
            className="pointer-events-none absolute inset-y-0 left-0 w-1/3"
            style={{
              animation: "pv-sheen var(--pv-cycle,3.6s) ease-in-out infinite",
              background:
                "linear-gradient(100deg, transparent, rgba(var(--ink-rgb),0.10), transparent)",
            }}
          />
        </div>

        {/* Indeterminate build bar pinned to the bottom edge of the canvas. */}
        <div className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-[rgba(var(--ink-rgb),0.06)]">
          <div
            className="absolute top-0 h-full w-2/5 rounded-full bg-gradient-to-r from-[var(--blue)] to-[var(--violet)]"
            style={{ animation: "pv-progress 1.6s cubic-bezier(0.4,0,0.2,1) infinite" }}
          />
        </div>
      </div>

      {/* Caption — mirrors SitePreview's read-out row so the card doesn't shift on swap. */}
      <div className="mt-2 flex min-h-5 items-center gap-1.5 text-xs text-[var(--muted)]">
        <span
          className="size-1.5 rounded-full bg-[var(--blue)]"
          style={{ animation: "pv-blink 1.4s ease-in-out infinite" }}
        />
        Assembling your docs<span className="db-grad font-medium">…</span>
      </div>
    </div>
  );
}
