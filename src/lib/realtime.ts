import "server-only";
import Pusher from "pusher";
import { ACTIVITY_EVENT, BILLING_EVENT, orgChannel, siteChannel } from "./realtime-client";

export { ACTIVITY_EVENT, BILLING_EVENT, orgChannel, siteChannel };
// Realtime publish + channel auth over the Pusher protocol (SPEC §10.3). Locally this
// talks to a self-hosted, Pusher-compatible Soketi container (docker-compose); in prod the
// same code points at hosted Pusher Channels — only env changes, the same swap pattern as
// Postgres (Neon) and object storage (R2). Vercel functions can't hold a socket open, so
// the browser connects to the realtime host directly; the server only ever *publishes* over
// Pusher's HTTP trigger API, which is a plain POST that works fine inside a serverless route.
//
// Realtime is a STRICT ENHANCEMENT layered over the existing poll: when these env vars are
// unset (CI, a bare local checkout with no Soketi), every helper here no-ops and the
// ActivityFeed's adaptive poll carries the feed exactly as before. So a missing/broken
// realtime backend can never 500 a sync or a page — it just degrades to polling.

// Hosted Pusher routes by `cluster`; Soketi (and any self-hosted server) instead wants an
// explicit host/port. We support both: set PUSHER_CLUSTER for hosted, or PUSHER_HOST/PORT
// for Soketi. Everything is read at call time (not module load) so tests can vary it.
function serverClient(): Pusher | null {
  const appId = process.env.PUSHER_APP_ID;
  const key = process.env.PUSHER_KEY;
  const secret = process.env.PUSHER_SECRET;
  // App id + key + secret are the irreducible minimum to publish or sign an auth response.
  if (!appId || !key || !secret) return null;

  const host = process.env.PUSHER_HOST;
  const cluster = process.env.PUSHER_CLUSTER;
  return new Pusher({
    appId,
    key,
    secret,
    // Soketi: explicit host (+ optional port), TLS off locally. Hosted: a cluster, TLS on.
    ...(host
      ? {
          host,
          port: process.env.PUSHER_PORT,
          useTLS: process.env.PUSHER_USE_TLS === "true",
        }
      : { cluster: cluster ?? "mt1", useTLS: true }),
  });
}

/**
 * Tell any browser watching this site that something changed — a sync started/resolved, an
 * automation run advanced — so it refetches now instead of waiting for its next poll. The
 * payload is intentionally empty — no row data transits the realtime host; whatever
 * authorized page is listening (Activity feed, the Automations run list/detail) re-fetches
 * from its own DB query, which stays the single source of truth. One generic per-site signal
 * rather than a per-feature event name, since every caller's reaction is the same shape:
 * "something on this site changed, go re-read it."
 *
 * Best-effort by contract: unconfigured → no-op; a transport error is logged and swallowed.
 * Correctness never depends on this firing (the durable DB row is always the record).
 */
export async function triggerActivity(siteId: string): Promise<void> {
  const client = serverClient();
  if (!client) return;
  try {
    await client.trigger(siteChannel(siteId), ACTIVITY_EVENT, {});
  } catch (e) {
    console.error(`[realtime] failed to publish ${ACTIVITY_EVENT} site=${siteId}`, e);
  }
}

/**
 * Tell any open dashboard for this org that its billing changed (SPEC §10 Billing) — the
 * Autumn webhook calls this after a plan/balance event, and OrgRealtimeRefresh re-renders the
 * route. Empty payload, same contract as triggerActivity: the listener re-reads from the
 * source of truth (Autumn, via the now-invalidated cache), nothing transits the socket.
 */
export async function triggerBilling(orgId: string): Promise<void> {
  const client = serverClient();
  if (!client) return;
  try {
    await client.trigger(orgChannel(orgId), BILLING_EVENT, {});
  } catch (e) {
    console.error(`[realtime] failed to publish ${BILLING_EVENT} org=${orgId}`, e);
  }
}

/**
 * Sign a private-channel subscription for the Pusher auth endpoint. Returns the auth body
 * pusher-js expects, or null when the caller isn't allowed (or realtime is unconfigured),
 * which the route turns into a 403. Authorization is the route's job — this only signs.
 */
export function authorizeRealtime(
  socketId: string,
  channel: string,
): { auth: string } | null {
  const client = serverClient();
  if (!client) return null;
  return client.authorizeChannel(socketId, channel);
}
