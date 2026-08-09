"use client";

import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import { textDiff } from "@papervine/mdx-prosemirror";
import { mintCollabTokenAction } from "@/lib/actions/authoring";
import { BroadcastProvider, type PeerInfo } from "./broadcast-provider";
import { HocuspocusTransport } from "./hocuspocus-transport";

// Collaboration: one Y.Doc per page-room, with Y.Text("mdx") holding the WHOLE raw MDX file as
// the single source of truth (the text-canonical decision — byte-exact git, never-break unknown
// MDX). Both editor panes are projections of this Y.Text.
//
// Two transports behind ONE interface (chosen at runtime, strict enhancement — never an error):
//   • NEXT_PUBLIC_COLLAB_URL set → Hocuspocus socket service (apps/collab): real cross-machine
//     multiplayer, with a server-authoritative doc so a joiner gets correct state.
//   • otherwise (CI, bare checkout, collab unconfigured) → BroadcastChannel: same-browser tabs.
// The Hocuspocus path still needs a room token; if the server says collab is disabled (no
// secret), we fall back to BroadcastChannel rather than fail.

interface CollabTransport {
  awareness: Awareness | null;
  onSynced(fn: () => void): () => void;
  onPeers(fn: (peers: PeerInfo[]) => void): () => void;
  setPresence(info: Omit<PeerInfo, "clientId">): void;
  destroy(): void;
  // Resolves whether THIS client should seed an empty room — see either transport's own
  // canSeed() doc comment for the race it closes (two clients freshly joining at once could
  // otherwise both conclude "nobody's here" and both insert the page text, doubling it).
  canSeed(): Promise<boolean>;
}

/** What a pane needs to bind itself to the shared document. */
export interface CollabBinding {
  /** Current full MDX text. */
  getText(): string;
  /** Push a new full-document string as a MINIMAL splice — preserves collaborators' edits/cursors. */
  setText(next: string): void;
  /** Fire on changes NOT originating from this pane's own setText (a peer, or the other pane). */
  onRemoteChange(fn: (text: string) => void): () => void;
}

export interface CollabDoc {
  binding: CollabBinding;
  peers: PeerInfo[];
  /** True once initial state has settled (seeded, or adopted from server/peer). */
  ready: boolean;
  /** The shared Y.Text — for a native editor binding (CodeMirror). Null until the room mounts. */
  ytext: Y.Text | null;
  /** The active transport's awareness (remote cursors) — Hocuspocus's, or a local-only one. */
  awareness: Awareness | null;
}

export interface CollabRoom {
  org: string;
  site: string;
  branch: string;
  path: string;
  initialMarkdown: string;
}

// A stable per-tab identity for presence. A tab keeps one name+color for its lifetime.
const NAMES = ["Otter", "Falcon", "Bramble", "Cinder", "Willow", "Marlin", "Sable", "Wren"];
const COLORS = ["#6366f1", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ef4444", "#14b8a6"];
function makeIdentity(clientId: number): Omit<PeerInfo, "clientId"> {
  const i = Math.abs(clientId) % NAMES.length;
  return { name: NAMES[i], color: COLORS[i] };
}

/**
 * Bootstraps the collaborative document for a page-room, seeding an empty room from
 * `initialMarkdown` exactly once (first client seeds; later clients adopt server/peer state).
 * Recreates cleanly when the room changes. `initialMarkdown` is read only at seed time.
 */
export function useCollabDoc(room: CollabRoom): CollabDoc {
  const { org, site, branch, path } = room;
  const [ready, setReady] = useState(false);
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [ytext, setYtext] = useState<Y.Text | null>(null);
  const [awareness, setAwareness] = useState<Awareness | null>(null);
  const bindingRef = useRef<CollabBinding | null>(null);
  // Keep the freshest initial content without retriggering the room effect.
  const initialRef = useRef(room.initialMarkdown);
  initialRef.current = room.initialMarkdown;

  useEffect(() => {
    const doc = new Y.Doc();
    const ytext = doc.getText("mdx");
    // A per-instance origin tags OUR local splices, so we can tell our own echoes from real
    // remote/other-pane changes in the observer below.
    const LOCAL = Symbol("pv-local");
    const remoteListeners = new Set<(text: string) => void>();

    ytext.observe((_e, tr) => {
      if (tr.origin === LOCAL) return; // our own edit — the pane already has it
      const text = ytext.toString();
      for (const fn of remoteListeners) fn(text);
    });

    const binding: CollabBinding = {
      getText: () => ytext.toString(),
      setText: (next) => {
        const edit = textDiff(ytext.toString(), next);
        if (!edit) return;
        doc.transact(() => {
          if (edit.remove) ytext.delete(edit.index, edit.remove);
          if (edit.insert) ytext.insert(edit.index, edit.insert);
        }, LOCAL);
      },
      onRemoteChange: (fn) => {
        remoteListeners.add(fn);
        return () => remoteListeners.delete(fn);
      },
    };
    bindingRef.current = binding;

    setReady(false);
    setPeers([]);
    setYtext(ytext);
    setAwareness(null);

    let transport: CollabTransport | null = null;
    let disposed = false;
    const identity = makeIdentity(doc.clientID);

    const wire = (t: CollabTransport) => {
      if (disposed) {
        t.destroy();
        return;
      }
      transport = t;
      t.setPresence(identity);
      setAwareness(t.awareness);
      t.onPeers(setPeers);
      t.onSynced(async () => {
        // First client in the room finds it empty → seed from the server-provided content. A
        // later client already received server/peer state (applied before onSynced fires, so
        // ytext is already non-empty here) — a no-op, and canSeed() is never even called for
        // that common case. Only the genuinely ambiguous "room still empty" case pays the
        // canSeed() tiebreak, which closes a real race: two clients freshly joining at once
        // could otherwise both conclude "nobody's here" and both insert the page text.
        const shouldSeed = ytext.length === 0 && initialRef.current && (await t.canSeed());
        if (disposed) return; // unmounted while canSeed() was pending — doc may be destroyed
        if (shouldSeed) doc.transact(() => ytext.insert(0, initialRef.current), LOCAL);
        setReady(true);
      });
    };

    const bcRoom = `${site}:${branch}:${path}`;
    const url = process.env.NEXT_PUBLIC_COLLAB_URL;
    if (url) {
      // Cross-machine: mint a room token, then connect. Server says disabled / errors → same-
      // browser fallback so the editor still collaborates across this browser's tabs.
      mintCollabTokenAction(org, site, branch, path)
        .then((res) => {
          if ("token" in res) wire(new HocuspocusTransport({ url, room: res.room, token: res.token, doc }));
          else wire(new BroadcastProvider(bcRoom, doc));
        })
        .catch(() => wire(new BroadcastProvider(bcRoom, doc)));
    } else {
      wire(new BroadcastProvider(bcRoom, doc));
    }

    return () => {
      disposed = true;
      transport?.destroy();
      doc.destroy();
      bindingRef.current = null;
      setYtext(null);
      setAwareness(null);
    };
  }, [org, site, branch, path]);

  // A stable binding facade so consumers don't churn when the underlying doc is recreated.
  const facadeRef = useRef<CollabBinding>({
    getText: () => bindingRef.current?.getText() ?? "",
    setText: (next) => bindingRef.current?.setText(next),
    onRemoteChange: (fn) => bindingRef.current?.onRemoteChange(fn) ?? (() => {}),
  });

  return { binding: facadeRef.current, peers, ready, ytext, awareness };
}
