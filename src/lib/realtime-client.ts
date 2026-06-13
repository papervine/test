// Client-safe realtime constants + config (SPEC §10.3). No `server-only` and no SDK import,
// so both the browser ActivityFeed and the server-only `realtime.ts` can share the channel
// name and event name (one definition, no drift). The Pusher *server* SDK lives in
// `realtime.ts`; the browser dynamically imports `pusher-js` only when this config is present.

// One private channel per site; the Live and Previews feeds share it (see realtime.ts).
export function siteChannel(siteId: string): string {
  return `private-site-${siteId}`;
}

export const ACTIVITY_EVENT = "activity:changed";

// pusher-js client options, minus the version-specific type (kept loose so we don't pull the
// SDK's types into shared code). `cluster: ""` is required by pusher-js when using an
// explicit wsHost (Soketi) — it would otherwise build a `*.pusher.com` URL.
export type RealtimeClientConfig = {
  key: string;
  // `cluster` is always set (pusher-js requires it — "" when using an explicit wsHost); the
  // rest are loose so we don't pull the SDK's option types into shared code.
  options: { cluster: string } & Record<string, unknown>;
};

// Read the browser's realtime config from NEXT_PUBLIC_* env (inlined at build). Returns null
// when unset — the ActivityFeed then never subscribes and runs on its poll fallback alone,
// which is exactly today's behavior. Soketi: an explicit ws host/port, TLS off locally.
// Hosted Pusher Channels: a cluster, TLS on. Auth for the private channel always goes to our
// own same-origin endpoint (the app host), which enforces org membership.
export function realtimeClientConfig(): RealtimeClientConfig | null {
  const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
  if (!key) return null;

  const authEndpoint = "/api/pusher/auth";
  const host = process.env.NEXT_PUBLIC_PUSHER_HOST;
  if (host) {
    return {
      key,
      options: {
        wsHost: host,
        wsPort: Number(process.env.NEXT_PUBLIC_PUSHER_PORT ?? 6001),
        forceTLS: process.env.NEXT_PUBLIC_PUSHER_USE_TLS === "true",
        enabledTransports: ["ws", "wss"],
        cluster: "",
        authEndpoint,
      },
    };
  }
  return {
    key,
    options: {
      cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER ?? "mt1",
      forceTLS: true,
      authEndpoint,
    },
  };
}
