import type { PeerInfo } from "./broadcast-provider";

// The peer roster derived from Yjs awareness — pure, so it's unit-testable and, crucially, so the
// dedupe that keeps it from churning React state is provable. Awareness "change" fires on every
// cursor move (CollabCarets writes a `visualCursor` field), but the ROSTER only depends on each
// client's `user` identity. Deriving the roster + a stable key here lets HocuspocusTransport skip
// notifying React when only cursors moved — the fix for the "Maximum update depth" nav loop.

interface AwarenessUser {
  clientId: number;
  name: string;
  color: string;
}

/** Everyone but us who has published a presence identity, from an awareness state snapshot. */
export function peersFromStates(
  states: Iterable<[number, Record<string, unknown>]>,
  selfClientId: number,
): PeerInfo[] {
  const peers: PeerInfo[] = [];
  for (const [clientId, state] of states) {
    if (clientId === selfClientId) continue;
    const user = (state as { user?: AwarenessUser }).user;
    if (user) peers.push({ clientId, name: user.name, color: user.color });
  }
  return peers;
}

/**
 * A stable identity for a roster: same set of clients (with the same name/color) → same key,
 * regardless of order or of any non-`user` awareness fields (e.g. `visualCursor`). Used to dedupe
 * awareness "change" events down to actual join/leave/rename so cursor movement never re-renders.
 */
export function rosterKey(peers: PeerInfo[]): string {
  return peers
    .map((p) => `${p.clientId}:${p.name}:${p.color}`)
    .sort()
    .join("|");
}
