"use client";

import { useEffect, useRef } from "react";
import {
  ACTIVITY_EVENT,
  realtimeClientConfig,
  siteChannel,
} from "@/lib/realtime-client";

// Centralized realtime wiring for the dashboard (SPEC §10.3). `runSync` publishes to a site's
// private channel on sync start/finish; any client that cares (the Activity feed, the building
// preview, future surfaces) subscribes here instead of re-implementing the fiddly bits — the
// config gate, the dynamic `pusher-js` import (kept out of the bundle when realtime is off),
// channel sub/unsub, and cleanup. Realtime is always a strict ENHANCEMENT: when it's
// unconfigured or the socket drops, callers fall back to polling, so the UI never depends on it.

/**
 * Subscribe to a site's realtime channel and invoke `onSignal` each time a sync start/finish is
 * published. No-op (returns immediately) when realtime is unconfigured — pair it with a poll.
 *
 * `onSignal` is kept in a ref, so passing a fresh closure each render does NOT re-subscribe; the
 * subscription re-arms only when `siteId` changes.
 */
export function useSiteRealtime(siteId: string, onSignal: () => void): void {
  const handler = useRef(onSignal);
  handler.current = onSignal;

  useEffect(() => {
    const config = realtimeClientConfig();
    if (!config) return; // unconfigured → caller's poll fallback carries it

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
        channel.bind(ACTIVITY_EVENT, () => handler.current());
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
}

/**
 * Realtime-first "re-run this on every sync change", with a poll fallback baked in — for the
 * simple case where the reaction is just `router.refresh()` (vs. the Activity feed, which owns a
 * bespoke adaptive/abortable fetch poll and so uses `useSiteRealtime` directly).
 *
 * Realtime drives the instant update; the interval is a backstop. When realtime is configured we
 * poll slowly (only to catch a dropped socket); when it's off we poll briskly (it's the only
 * signal). `refresh` should be stable (wrap in `useCallback`).
 */
export function useRealtimeRefresh(
  siteId: string,
  refresh: () => void,
  opts: { livePollMs?: number; fallbackPollMs?: number } = {},
): void {
  useSiteRealtime(siteId, refresh);

  const { livePollMs = 20_000, fallbackPollMs = 5_000 } = opts;
  useEffect(() => {
    const ms = realtimeClientConfig() ? livePollMs : fallbackPollMs;
    const id = setInterval(refresh, ms);
    return () => clearInterval(id);
  }, [refresh, livePollMs, fallbackPollMs]);
}
