import type { Doc } from "yjs";
import type { Awareness } from "y-protocols/awareness";
import { HocuspocusProvider } from "@hocuspocus/provider";
import type { PeerInfo } from "./broadcast-provider";
import { peersFromStates, rosterKey, isLowestClientId } from "./peer-roster";

// Cross-machine transport: binds the shared Y.Doc to the standalone Hocuspocus socket service
// (apps/collab). Same surface as BroadcastProvider (onSynced / onPeers / setPresence / destroy)
// so useCollabDoc can pick either — BroadcastChannel for same-browser tabs, this for real
// multiplayer across machines. Presence rides Hocuspocus's built-in awareness (unlike the
// hand-rolled peer map the BroadcastChannel path needs).

// How long canSeed() waits before deciding — a little more slack than BroadcastProvider's
// window, since this goes over a real network hop rather than same-process BroadcastChannel.
const SEED_DECISION_WINDOW_MS = 150;

/** Adapter around HocuspocusProvider matching the BroadcastProvider transport shape. */
export class HocuspocusTransport {
  private provider: HocuspocusProvider;
  private peerListeners = new Set<(peers: PeerInfo[]) => void>();
  private syncListeners = new Set<() => void>();
  private synced = false;
  private destroyed = false;
  // The last roster we notified listeners about, as a stable key. Awareness "change" fires on every
  // cursor move (CollabCarets writes visualCursor into awareness), but the peer roster only changes
  // on join/leave/rename — so we dedupe to avoid churning React state on every keystroke/cursor tick.
  private lastRosterKey = " "; // sentinel that no real roster ("" for empty) can equal

  constructor(opts: { url: string; room: string; token: string; doc: Doc }) {
    this.provider = new HocuspocusProvider({
      url: opts.url,
      name: opts.room,
      token: opts.token,
      document: opts.doc,
      onSynced: () => this.markSynced(),
    });
    // Awareness → peer roster. The provider owns a y-protocols Awareness bound to the same doc.
    this.provider.awareness?.on("change", this.emitPeers);
  }

  /** The provider's awareness, for the Source (CodeMirror) editor to render remote cursors. */
  get awareness(): Awareness | null {
    return (this.provider.awareness as Awareness | null) ?? null;
  }

  private markSynced = () => {
    if (this.synced || this.destroyed) return;
    this.synced = true;
    for (const fn of this.syncListeners) fn();
  };

  /** The current peer roster (everyone but us who has published a presence identity). */
  private computePeers(): PeerInfo[] {
    const awareness = this.provider.awareness;
    if (!awareness) return [];
    return peersFromStates(awareness.getStates(), awareness.clientID);
  }

  // Awareness-"change" handler: notify listeners ONLY when the roster actually changed. Cursor
  // movement fires this constantly (visualCursor updates) but leaves the roster untouched; emitting
  // a fresh array every time would setState → re-render on every tick, which under a navigation
  // transition compounds into "Maximum update depth exceeded". Dedupe by a stable roster key.
  private emitPeers = () => {
    const peers = this.computePeers();
    const key = rosterKey(peers);
    if (key === this.lastRosterKey) return;
    this.lastRosterKey = key;
    for (const fn of this.peerListeners) fn(peers);
  };

  setPresence(info: Omit<PeerInfo, "clientId">) {
    const awareness = this.provider.awareness;
    if (!awareness) return;
    awareness.setLocalStateField("user", { clientId: awareness.clientID, ...info });
  }

  onPeers(fn: (peers: PeerInfo[]) => void): () => void {
    this.peerListeners.add(fn);
    fn(this.computePeers()); // replay the current roster to this subscriber (bypasses the dedupe)
    return () => this.peerListeners.delete(fn);
  }

  onSynced(fn: () => void): () => void {
    if (this.synced) {
      fn();
      return () => {};
    }
    this.syncListeners.add(fn);
    return () => this.syncListeners.delete(fn);
  }

  /**
   * Should THIS client be the one to seed an empty room? See BroadcastProvider's `canSeed`
   * for the full rationale — same race, different peer-discovery signal: `synced` fires purely
   * off the client↔server Yjs handshake (confirmed in `@hocuspocus/provider`'s source), with no
   * peer-count info at that moment, so two clients racing to join a genuinely empty document
   * could otherwise both seed independently and double the content. `useCollabDoc`'s `wire()`
   * already calls `setPresence` immediately on construction (before `onSynced` ever fires, for
   * both transports), so a racing peer's clientID is reliably in `awareness.getStates()` — keyed
   * by clientID by y-protocols' own design — by the time this window elapses.
   */
  canSeed(): Promise<boolean> {
    return new Promise((resolve) => {
      setTimeout(() => {
        const awareness = this.provider.awareness;
        if (!awareness) {
          resolve(true); // no awareness at all — nothing to race against
          return;
        }
        resolve(isLowestClientId(awareness.clientID, awareness.getStates().keys()));
      }, SEED_DECISION_WINDOW_MS);
    });
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.provider.awareness?.off("change", this.emitPeers);
    this.provider.destroy();
  }
}
