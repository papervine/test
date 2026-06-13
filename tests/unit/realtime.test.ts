import { describe, it, expect, afterEach } from "vitest";
import {
  realtimeClientConfig,
  siteChannel,
  ACTIVITY_EVENT,
} from "@/lib/realtime-client";
import { triggerActivity, authorizeRealtime } from "@/lib/realtime";

// The realtime layer (SPEC §10.3) is a strict enhancement over the Activity feed's poll:
// when its env vars are unset it must fully no-op (so CI and bare checkouts are unaffected),
// and the client config must build the right shape for Soketi (local) vs hosted Pusher.

const PUBLIC_KEYS = [
  "NEXT_PUBLIC_PUSHER_KEY",
  "NEXT_PUBLIC_PUSHER_HOST",
  "NEXT_PUBLIC_PUSHER_PORT",
  "NEXT_PUBLIC_PUSHER_USE_TLS",
  "NEXT_PUBLIC_PUSHER_CLUSTER",
];
const SERVER_KEYS = ["PUSHER_APP_ID", "PUSHER_KEY", "PUSHER_SECRET"];

afterEach(() => {
  for (const k of [...PUBLIC_KEYS, ...SERVER_KEYS]) delete process.env[k];
});

describe("siteChannel", () => {
  it("is a private channel namespaced by site id (the auth route round-trips this)", () => {
    expect(siteChannel("abc-123")).toBe("private-site-abc-123");
    expect(ACTIVITY_EVENT).toBe("activity:changed");
  });
});

describe("realtimeClientConfig", () => {
  it("returns null when no public key is set → feed stays on poll-only", () => {
    expect(realtimeClientConfig()).toBeNull();
  });

  it("builds an explicit-host (Soketi) config when NEXT_PUBLIC_PUSHER_HOST is set", () => {
    process.env.NEXT_PUBLIC_PUSHER_KEY = "papervine-key";
    process.env.NEXT_PUBLIC_PUSHER_HOST = "127.0.0.1";
    process.env.NEXT_PUBLIC_PUSHER_PORT = "6001";
    process.env.NEXT_PUBLIC_PUSHER_USE_TLS = "false";
    const config = realtimeClientConfig();
    expect(config?.key).toBe("papervine-key");
    expect(config?.options).toMatchObject({
      wsHost: "127.0.0.1",
      wsPort: 6001,
      forceTLS: false,
      cluster: "", // required by pusher-js when wsHost is explicit
      authEndpoint: "/api/pusher/auth",
    });
  });

  it("builds a cluster (hosted Pusher) config when no host is set", () => {
    process.env.NEXT_PUBLIC_PUSHER_KEY = "live-key";
    process.env.NEXT_PUBLIC_PUSHER_CLUSTER = "us3";
    const config = realtimeClientConfig();
    expect(config?.options).toMatchObject({
      cluster: "us3",
      forceTLS: true,
      authEndpoint: "/api/pusher/auth",
    });
    expect(config?.options.wsHost).toBeUndefined();
  });
});

describe("server publish/auth no-op when unconfigured", () => {
  it("triggerActivity resolves without throwing when realtime is off", async () => {
    await expect(triggerActivity("site-1")).resolves.toBeUndefined();
  });

  it("authorizeRealtime returns null when realtime is off (→ route 503)", () => {
    expect(authorizeRealtime("123.456", siteChannel("site-1"))).toBeNull();
  });
});
