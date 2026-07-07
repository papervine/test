import { Server } from "@hocuspocus/server";
import { verifyCollabToken, isConfigured } from "./auth.js";

// Papervine collaborative editing socket (SPEC §9.2 / §10.3). A standalone Hocuspocus (Yjs CRDT)
// WebSocket server — the always-on piece Vercel can't host. Deliberately MINIMAL:
//
//   • It relays the shared Y.Doc between clients and runs the Yjs sync protocol (so a joiner gets
//     correct current state, not a stale snapshot + deltas).
//   • It holds NO session/RBAC (the Next app mints a per-room token; we just verify it) and NO
//     content pipeline: the FIRST client seeds the doc from the page's draft text it already has,
//     and every client debounce-flushes back to the draft store through the Next app. So the doc
//     is transient coordination state; git-backed draftFile stays the source of truth. If this
//     process restarts, the next client re-seeds from the draft — no data loss, just a fresh CRDT.
//
// Persisting the Y.Doc binary (for cross-restart CRDT continuity) is a clean later add via
// @hocuspocus/extension-database; not needed for correctness given text-canonical + client flush.

const port = Number(process.env.COLLAB_PORT ?? 1234);

const server = new Server({
  port,
  // Reject a connection unless it carries a valid token whose room matches the document being
  // opened. Throwing here closes the socket with an auth error; the client falls back to
  // same-browser BroadcastChannel sync.
  async onAuthenticate({ documentName, token }) {
    const claims = await verifyCollabToken(token);
    if (!claims) throw new Error("collab: invalid or expired token");
    if (claims.room !== documentName) throw new Error("collab: token/room mismatch");
    // Exposed to hooks as `context`; awareness (name/color) is set client-side.
    return { userId: claims.userId, name: claims.name };
  },
});

if (!isConfigured()) {
  // Fail loud: a running-but-open socket would accept anyone. Better to not start.
  console.error("[collab] COLLAB_JWT_SECRET is not set — refusing to start an unauthenticated socket.");
  process.exit(1);
}

server
  .listen()
  .then(() => console.log(`[collab] Hocuspocus listening on ws://0.0.0.0:${port}`))
  .catch((err) => {
    console.error("[collab] failed to start:", err);
    process.exit(1);
  });
