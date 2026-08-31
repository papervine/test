import { describe, it, expect, vi } from "vitest";
import * as Y from "yjs";
import { createSharedText } from "@/components/editor/collab/shared-text";

// The editor's shared-document write path (SPEC §9.2), exercised headless over real Y.Docs — no
// browser, no socket, no React. The rule under test is the settle gate: a local write before the
// room's state has arrived must not reach the shared text, because merging it with the state that
// then arrives DOUBLES the document.

const PAGE = '---\ntitle: "Introduction"\n---\nWelcome to the starter.\n';

/** A second client that already holds the page — i.e. the person you're joining. */
function peerHolding(text: string): Y.Doc {
  const peer = new Y.Doc();
  peer.getText("mdx").insert(0, text);
  return peer;
}

/** "The server's copy arrives" — the state a joining client receives and applies. */
function sync(from: Y.Doc, to: Y.Doc) {
  Y.applyUpdate(to, Y.encodeStateAsUpdate(from));
}

describe("createSharedText — the settle gate", () => {
  it("holds a local write until the room has settled", () => {
    const doc = new Y.Doc();
    const shared = createSharedText(doc, doc.getText("mdx"));

    expect(shared.isSettled()).toBe(false);
    shared.setText(PAGE);
    expect(shared.getText()).toBe("");
  });

  it("applies local writes once settled", () => {
    const doc = new Y.Doc();
    const shared = createSharedText(doc, doc.getText("mdx"));

    shared.settle(PAGE);
    shared.setText(PAGE);
    expect(shared.getText()).toBe(PAGE);

    shared.setText(PAGE + "More.\n");
    expect(shared.getText()).toBe(PAGE + "More.\n");
  });

  it("REGRESSION: refreshing with a peer in the room doesn't double the page", () => {
    // Exactly the reported bug: someone else is already editing, you reload, and the page saves
    // doubled up on itself. On reload the panes render immediately from the server-rendered draft
    // and the Visual editor's mount-time projection fires onChange — before the room has synced.
    const peer = peerHolding(PAGE);
    const mine = new Y.Doc();
    const shared = createSharedText(mine, mine.getText("mdx"));

    shared.setText(PAGE); // the pane's mount-time write, pre-sync
    sync(peer, mine); // the room's real state lands a moment later
    shared.settle(PAGE);

    expect(shared.getText()).toBe(PAGE);
    expect(shared.getText().match(/title:/g)).toHaveLength(1);
  });

  it("keeps keystrokes typed before the room settled", () => {
    // Dropping pre-settle writes outright also fixed the doubling, but silently ate anything typed
    // in the first few hundred ms after opening the editor — which the node-view e2e cases (they
    // type the instant the editor appears) noticed immediately.
    const mine = new Y.Doc();
    const shared = createSharedText(mine, mine.getText("mdx"));

    shared.setText(PAGE + "typed early\n"); // user types before sync
    shared.seed(PAGE); // we're first in the room, so we seed it
    shared.settle(PAGE);

    expect(shared.getText()).toBe(PAGE + "typed early\n");
  });

  it("keeps early keystrokes when the room settles on the same baseline as a peer", () => {
    const peer = peerHolding(PAGE);
    const mine = new Y.Doc();
    const shared = createSharedText(mine, mine.getText("mdx"));

    shared.setText(PAGE + "typed early\n");
    sync(peer, mine);
    shared.settle(PAGE);

    expect(shared.getText()).toBe(PAGE + "typed early\n");
    expect(shared.getText().match(/title:/g)).toHaveLength(1);
  });

  it("drops a held write when a peer's text is ahead of our baseline", () => {
    // Our held string is a whole-document snapshot of a stale base; splicing it would delete the
    // peer's paragraph. The pane adopts the settled text instead.
    const ahead = PAGE + "A peer wrote this while we were connecting.\n";
    const peer = peerHolding(ahead);
    const mine = new Y.Doc();
    const shared = createSharedText(mine, mine.getText("mdx"));

    shared.setText(PAGE + "typed early\n");
    sync(peer, mine);
    shared.settle(PAGE);

    expect(shared.getText()).toBe(ahead);
    expect(shared.getText()).not.toContain("typed early");
  });

  it("pins the mechanism: the same sequence WITHOUT the gate doubles it", () => {
    // Not testing our code — documenting why the gate exists, so nobody "simplifies" it away.
    // This is the ungated write the old binding performed.
    const peer = peerHolding(PAGE);
    const mine = new Y.Doc();
    mine.getText("mdx").insert(0, PAGE); // pre-sync local insert into a still-empty text
    sync(peer, mine);

    expect(mine.getText("mdx").toString().match(/title:/g)).toHaveLength(2);
  });

  it("still lets the seed through before settle — an empty room needs its content", () => {
    const doc = new Y.Doc();
    const shared = createSharedText(doc, doc.getText("mdx"));

    shared.seed(PAGE);
    expect(shared.getText()).toBe(PAGE);
  });

  it("ignores an empty seed", () => {
    const doc = new Y.Doc();
    const shared = createSharedText(doc, doc.getText("mdx"));

    shared.seed("");
    expect(shared.getText()).toBe("");
  });
});

describe("createSharedText — change notification", () => {
  it("notifies on a remote change but never on our own write", () => {
    const peer = peerHolding("");
    const mine = new Y.Doc();
    const shared = createSharedText(mine, mine.getText("mdx"));
    shared.settle(PAGE);

    const heard = vi.fn();
    shared.onRemoteChange(heard);

    shared.setText(PAGE);
    expect(heard).not.toHaveBeenCalled(); // our own edit — the pane already has it

    peer.getText("mdx").insert(0, "Peer wrote this.\n");
    sync(peer, mine);
    expect(heard).toHaveBeenCalled();
    expect(heard.mock.lastCall?.[0]).toContain("Peer wrote this.");
  });

  it("notifies when a held write is applied at settle, so the typist's own pane re-reads", () => {
    // The pane sets its state from the text as it stood when the room settled — before the held
    // splice — so without this notification the person who typed can be the only one still looking
    // at the older projection.
    const mine = new Y.Doc();
    const shared = createSharedText(mine, mine.getText("mdx"));
    const heard = vi.fn();
    shared.onRemoteChange(heard);

    shared.setText(PAGE + "typed early\n");
    shared.seed(PAGE);
    shared.settle(PAGE);

    expect(heard).toHaveBeenCalledTimes(1);
    expect(heard.mock.lastCall?.[0]).toBe(PAGE + "typed early\n");
  });

  it("doesn't notify at settle when there was nothing held", () => {
    const mine = new Y.Doc();
    const shared = createSharedText(mine, mine.getText("mdx"));
    const heard = vi.fn();
    shared.onRemoteChange(heard);

    shared.seed(PAGE);
    shared.settle(PAGE);
    expect(heard).not.toHaveBeenCalled();
  });

  it("doesn't notify the seeding client about its own seed", () => {
    const doc = new Y.Doc();
    const shared = createSharedText(doc, doc.getText("mdx"));
    const heard = vi.fn();
    shared.onRemoteChange(heard);

    shared.seed(PAGE);
    expect(heard).not.toHaveBeenCalled();
  });

  it("stops notifying after unsubscribe", () => {
    const peer = peerHolding("");
    const mine = new Y.Doc();
    const shared = createSharedText(mine, mine.getText("mdx"));
    const heard = vi.fn();
    shared.onRemoteChange(heard)();

    peer.getText("mdx").insert(0, "x");
    sync(peer, mine);
    expect(heard).not.toHaveBeenCalled();
  });
});
