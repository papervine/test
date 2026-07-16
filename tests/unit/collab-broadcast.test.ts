import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import * as Y from "yjs";
import { BroadcastProvider, type PeerInfo } from "@/components/editor/collab/broadcast-provider";

// The service-less (same-browser) transport: two BroadcastProviders on one room must sync the Y.Doc
// and the presence roster, and a late joiner must adopt the current state. Node has a global
// BroadcastChannel and Yjs runs headless, so the whole hello/state/update/presence protocol is
// exercisable in-process — the only thing missing is `window` (the provider registers a
// beforeunload handler), which we stub. This is the regression net for editing across your own tabs.

const origWindow = (globalThis as { window?: unknown }).window;
beforeAll(() => {
  (globalThis as { window?: unknown }).window = {
    addEventListener() {},
    removeEventListener() {},
  };
});
afterAll(() => {
  (globalThis as { window?: unknown }).window = origWindow;
});

// Track everything created so we always close channels (open ones keep the event loop alive).
const live: Array<{ destroy(): void }> = [];
const docs: Y.Doc[] = [];
function provider(room: string): { p: BroadcastProvider; doc: Y.Doc } {
  const doc = new Y.Doc();
  const p = new BroadcastProvider(room, doc);
  live.push(p);
  docs.push(doc);
  return { p, doc };
}
afterEach(() => {
  while (live.length) live.pop()!.destroy();
  while (docs.length) docs.pop()!.destroy();
});

// A fresh room name per test so leftover async messages can't cross-talk between tests.
let n = 0;
const room = () => `test-room-${n++}`;

describe("BroadcastProvider (same-browser sync)", () => {
  it("relays an incremental Y.Doc edit from one tab to another", async () => {
    const r = room();
    const { doc: a } = provider(r);
    const { doc: b } = provider(r);

    a.getText("mdx").insert(0, "hello from A");

    await vi.waitFor(() => expect(b.getText("mdx").toString()).toBe("hello from A"), { timeout: 1000 });
  });

  it("merges concurrent edits from both tabs (CRDT convergence)", async () => {
    const r = room();
    const { doc: a } = provider(r);
    const { doc: b } = provider(r);

    a.getText("mdx").insert(0, "AAA");
    b.getText("mdx").insert(0, "BBB");

    await vi.waitFor(
      () => {
        const ta = a.getText("mdx").toString();
        const tb = b.getText("mdx").toString();
        expect(ta).toBe(tb); // converged
        expect(ta).toContain("AAA");
        expect(ta).toContain("BBB");
      },
      { timeout: 1000 },
    );
  });

  it("hands a late joiner the full current state (hello/state handshake)", async () => {
    const r = room();
    const { doc: a } = provider(r);
    a.getText("mdx").insert(0, "seeded before B joined");

    // B joins after A already has content.
    const { p: pb, doc: b } = provider(r);
    let bSynced = false;
    pb.onSynced(() => (bSynced = true));

    await vi.waitFor(
      () => {
        expect(b.getText("mdx").toString()).toBe("seeded before B joined");
        expect(bSynced).toBe(true);
      },
      { timeout: 1000 },
    );
  });

  it("shows peers in each other's roster but never lists self", async () => {
    const r = room();
    const { p: pa } = provider(r);
    const { p: pb } = provider(r);

    let aRoster: PeerInfo[] = [];
    let bRoster: PeerInfo[] = [];
    pa.onPeers((list) => (aRoster = list));
    pb.onPeers((list) => (bRoster = list));

    pa.setPresence({ name: "Ada", color: "#6366f1" });
    pb.setPresence({ name: "Bo", color: "#ec4899" });

    await vi.waitFor(
      () => {
        expect(aRoster.map((p) => p.name)).toEqual(["Bo"]); // A sees B, not itself
        expect(bRoster.map((p) => p.name)).toEqual(["Ada"]); // B sees A, not itself
      },
      { timeout: 1000 },
    );
  });

  it("replays the current roster immediately to a newly-subscribed observer", async () => {
    // onPeers must fire synchronously with the current roster on subscribe (not only on the next
    // change), so a late-mounting toolbar shows who's already here. Deterministic — no channel wait.
    const r = room();
    const { p: pa } = provider(r);
    const { p: pb } = provider(r);
    pa.setPresence({ name: "Ada", color: "#6366f1" });
    await vi.waitFor(() => {
      let seen: PeerInfo[] | null = null;
      const off = pb.onPeers((list) => (seen = list)); // subscribing must replay immediately
      off();
      expect(seen).not.toBeNull();
      expect(seen!.map((p) => p.name)).toEqual(["Ada"]);
    }, { timeout: 1000 });
  });
});
