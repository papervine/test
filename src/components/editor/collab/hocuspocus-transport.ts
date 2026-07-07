import type { Doc } from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import type { PeerInfo } from "./broadcast-provider";

// Cross-machine transport: binds the shared Y.Doc to the standalone Hocuspocus socket service
// (apps/collab). Same surface as BroadcastProvider (onSynced / onPeers / setPresence / destroy)
// so useCollabDoc can pick either — BroadcastChannel for same-browser tabs, this for real
// multiplayer across machines. Presence rides Hocuspocus's built-in awareness (unlike the
// hand-rolled peer map the BroadcastChannel path needs).

interface AwarenessUser {
  clientId: number;
  name: string;
  color: string;
}

/** Adapter around HocuspocusProvider matching the BroadcastProvider transport shape. */
export class HocuspocusTransport {
  private provider: HocuspocusProvider;
  private peerListeners = new Set<(peers: PeerInfo[]) => void>();
  private syncListeners = new Set<() => void>();
  private synced = false;
  private destroyed = false;

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

  private markSynced = () => {
    if (this.synced || this.destroyed) return;
    this.synced = true;
    for (const fn of this.syncListeners) fn();
  };

  private emitPeers = () => {
    const awareness = this.provider.awareness;
    if (!awareness) return;
    const self = awareness.clientID;
    const peers: PeerInfo[] = [];
    for (const [clientId, state] of awareness.getStates()) {
      if (clientId === self) continue;
      const user = (state as { user?: AwarenessUser }).user;
      if (user) peers.push({ clientId, name: user.name, color: user.color });
    }
    for (const fn of this.peerListeners) fn(peers);
  };

  setPresence(info: Omit<PeerInfo, "clientId">) {
    const awareness = this.provider.awareness;
    if (!awareness) return;
    awareness.setLocalStateField("user", { clientId: awareness.clientID, ...info });
  }

  onPeers(fn: (peers: PeerInfo[]) => void): () => void {
    this.peerListeners.add(fn);
    this.emitPeers();
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

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.provider.awareness?.off("change", this.emitPeers);
    this.provider.destroy();
  }
}
