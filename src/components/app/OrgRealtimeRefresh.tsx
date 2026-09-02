"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { BILLING_EVENT, orgChannel, realtimeClientConfig } from "@/lib/realtime-client";

/**
 * Re-render the dashboard when the org's billing changes (SPEC §10 Billing). The Autumn
 * webhook publishes one signal on the org's private channel; this subscribes and calls
 * `router.refresh()`, which re-runs every server component on the current route — so an
 * "Automations come with Pro" card becomes the real Automations page the moment the upgrade
 * lands, and the rail's "Trialing" pills drop when a trial ends, with no reload.
 *
 * Strict enhancement, same contract as the Activity feed's realtime: unconfigured → renders
 * nothing and does nothing (the page is still correct on the next navigation, because billing
 * reads are live or cached for at most a minute). Renders no DOM.
 */
export function OrgRealtimeRefresh({ orgId }: { orgId: string }) {
  const router = useRouter();
  const refresh = useRef(() => router.refresh());
  refresh.current = () => router.refresh();

  useEffect(() => {
    const config = realtimeClientConfig();
    if (!config) return;
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    const channelName = orgChannel(orgId);
    import("pusher-js")
      .then(({ default: Pusher }) => {
        if (cancelled) return;
        const pusher = new Pusher(config.key, config.options as ConstructorParameters<typeof Pusher>[1]);
        const channel = pusher.subscribe(channelName);
        const onSignal = () => refresh.current();
        channel.bind(BILLING_EVENT, onSignal);
        cleanup = () => {
          channel.unbind(BILLING_EVENT, onSignal);
          pusher.unsubscribe(channelName);
          pusher.disconnect();
        };
      })
      .catch(() => {
        // pusher-js failed to load — polling/next-navigation semantics carry on.
      });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [orgId]);

  return null;
}
