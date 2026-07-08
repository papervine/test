import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";

// Service-less Yjs transport over BroadcastChannel — syncs a Y.Doc across tabs of the SAME
// browser/origin with zero infrastructure. This is the Phase-3 (in-memory) stand-in for the
// Phase-4 Hocuspocus WebSocket service: same contract (relay Yjs updates + presence, hand a
// joining peer the current state), so swapping it for HocuspocusProvider later is a drop-in.
//
// Why not the real awareness CRDT (y-protocols/awareness)? Phase-3 presence is just "who else
// is here" — a lightweight peer map (heartbeat-free: hello/state/bye) avoids pulling in
// y-protocols. Character-level remote cursors arrive with the CodeMirror/y-codemirror.next
// upgrade, which brings its own awareness.

export interface PeerInfo {
  clientId: number;
  name: string;
  color: string;
}

type Msg =
  // A new tab joined and is asking existing peers for the doc state + their presence.
  | { t: "hello"; from: number; self: PeerInfo | null }
  // Reply to a hello: the full doc state as a Yjs update.
  | { t: "state"; to: number; u: Uint8Array }
  // An incremental doc update to merge.
  | { t: "update"; u: Uint8Array }
  // A presence upsert (self changed) or, with peer:null, a leave.
  | { t: "presence"; id: number; peer: PeerInfo | null };

/**
 * Relays a Y.Doc across same-origin tabs via BroadcastChannel. Construct once per room; call
 * {@link setPresence} to publish who you are, {@link onPeers} to observe the roster, and
 * {@link onSynced} to learn when initial state has settled (so the caller can seed an empty doc
 * exactly once — the first tab seeds, later tabs adopt the received state).
 */
export class BroadcastProvider {
  readonly doc: Y.Doc;
  // A local-only Awareness so the Source (CodeMirror) editor has one to bind to. Same-browser
  // tabs don't share it over the channel (bc presence rides the peer map above), so it just
  // carries THIS tab's cursor — real cross-tab remote cursors are the Hocuspocus path's job.
  readonly awareness: Awareness;
  private channel: BroadcastChannel;
  private self: PeerInfo | null = null;
  private peers = new Map<number, PeerInfo>();
  private peerListeners = new Set<(peers: PeerInfo[]) => void>();
  private synced = false;
  private syncListeners = new Set<() => void>();
  private syncTimer: ReturnType<typeof setTimeout>;
  private destroyed = false;

  constructor(roomId: string, doc: Y.Doc) {
    this.doc = doc;
    this.awareness = new Awareness(doc);
    this.channel = new BroadcastChannel(`pv-collab:${roomId}`);
    this.channel.onmessage = (e: MessageEvent<Msg>) => this.handle(e.data);
    doc.on("update", this.onDocUpdate);
    window.addEventListener("beforeunload", this.onUnload);

    // Ask existing peers for state. If one replies we adopt it; if nobody answers within the
    // window, we're the first tab and the caller should seed. BroadcastChannel delivery within a
    // browser is sub-millisecond, so this window is imperceptible yet safe.
    this.post({ t: "hello", from: doc.clientID, self: this.self });
    this.syncTimer = setTimeout(() => this.markSynced(), 80);
  }

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this || this.destroyed) return; // don't echo updates we applied from a peer
    this.post({ t: "update", u: update });
  };

  private onUnload = () => this.destroy();

  private handle(msg: Msg) {
    if (this.destroyed) return;
    switch (msg.t) {
      case "hello": {
        // Hand the newcomer our full state and presence.
        this.post({ t: "state", to: msg.from, u: Y.encodeStateAsUpdate(this.doc) });
        if (this.self) this.post({ t: "presence", id: this.self.clientId, peer: this.self });
        if (msg.self) this.upsertPeer(msg.self);
        break;
      }
      case "state": {
        if (msg.to !== this.doc.clientID) return; // addressed to a specific joiner
        Y.applyUpdate(this.doc, msg.u, this);
        this.markSynced(); // state received — settle immediately, don't wait out the timer
        break;
      }
      case "update":
        Y.applyUpdate(this.doc, msg.u, this);
        break;
      case "presence":
        if (msg.peer) this.upsertPeer(msg.peer);
        else this.removePeer(msg.id);
        break;
    }
  }

  private post(msg: Msg) {
    // structured-clone carries Uint8Array fine; guard against posting on a closed channel.
    if (!this.destroyed) this.channel.postMessage(msg);
  }

  private markSynced() {
    if (this.synced) return;
    this.synced = true;
    clearTimeout(this.syncTimer);
    for (const fn of this.syncListeners) fn();
  }

  private upsertPeer(p: PeerInfo) {
    if (p.clientId === this.doc.clientID) return;
    this.peers.set(p.clientId, p);
    this.emitPeers();
  }

  private removePeer(id: number) {
    if (this.peers.delete(id)) this.emitPeers();
  }

  private emitPeers() {
    const list = [...this.peers.values()];
    for (const fn of this.peerListeners) fn(list);
  }

  /** Publish (or update) our own presence to the room. */
  setPresence(info: Omit<PeerInfo, "clientId">) {
    this.self = { clientId: this.doc.clientID, ...info };
    this.post({ t: "presence", id: this.self.clientId, peer: this.self });
    // Also mirror into awareness so the CodeMirror editor colours this tab's own cursor.
    this.awareness.setLocalStateField("user", { name: info.name, color: info.color });
  }

  /** Observe the peer roster (excludes self). Returns an unsubscribe. */
  onPeers(fn: (peers: PeerInfo[]) => void): () => void {
    this.peerListeners.add(fn);
    fn([...this.peers.values()]);
    return () => this.peerListeners.delete(fn);
  }

  /** Fires once initial state has settled (peer state received, or nobody answered). */
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
    clearTimeout(this.syncTimer);
    if (this.self) this.post({ t: "presence", id: this.self.clientId, peer: null });
    this.doc.off("update", this.onDocUpdate);
    window.removeEventListener("beforeunload", this.onUnload);
    this.awareness.destroy();
    this.channel.close();
  }
}
