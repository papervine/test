import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import * as Y from "yjs";
import { BroadcastProvider } from "@/components/editor/collab/broadcast-provider";
import { isLowestClientId } from "@/components/editor/collab/peer-roster";

// Regression net for a real, user-reported bug: two clients freshly joining the same room at
// once could each independently conclude "the room is empty, I'll seed it from the page's
// saved text" — and Yjs merges two independent inserts of the same text as two concatenated
// copies, not a dedup. "Doubled content, as if two saves got appended to each other" was the
// exact symptom. The fix is a deterministic tiebreak (lowest clientID seeds; everyone else
// defers) — these pin `BroadcastProvider.canSeed()` (the same-browser transport actually
// exercised in dev, matching collab-broadcast.test.ts's setup) and the pure comparison core
// `isLowestClientId` that `HocuspocusTransport.canSeed()` also uses (see peer-roster.ts) — that
// one can't be unit-tested end-to-end without a real @hocuspocus/provider/server, but its exact
// comparison logic is exercised directly below.

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

let n = 0;
const room = () => `test-seed-race-${n++}`;

// Node's BroadcastChannel has noticeably more per-message latency than a real browser's (a
// bare hello/reply round trip measured ~20ms locally, vs. the "sub-millisecond" a browser gives
// canSeed()'s production window headroom for). A generous fixed real delay before asking
// canSeed() to decide, well past both message-delivery variance and canSeed()'s own internal
// window, pins the COMPARISON logic once every peer is known — not the exact production timing
// constant (which is chosen for real-browser delivery, not this environment).
const SETTLE_MS = 150;
const settle = () => new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

describe("BroadcastProvider.canSeed (the double-seed race)", () => {
  it("a lone provider (no peer at all) can seed", async () => {
    const r = room();
    const { p } = provider(r);
    await settle();
    await expect(p.canSeed()).resolves.toBe(true);
  });

  it("when two providers race to join an empty room at once, only the lower clientID seeds", async () => {
    const r = room();
    // No artificial delay between construction — this IS the race: both send "hello" and both
    // reply to each other with their own still-empty state before either has seeded anything.
    const { p: pa, doc: a } = provider(r);
    const { p: pb, doc: b } = provider(r);
    await settle();

    const [canA, canB] = await Promise.all([pa.canSeed(), pb.canSeed()]);
    const aIsLower = a.clientID < b.clientID;
    expect(canA).toBe(aIsLower);
    expect(canB).toBe(!aIsLower);
    // Exactly one seeds — never both, never neither.
    expect(canA).not.toBe(canB);
  });

  it("generalizes past two: exactly the lowest clientID among three simultaneous joiners seeds", async () => {
    const r = room();
    const { p: pa, doc: a } = provider(r);
    const { p: pb, doc: b } = provider(r);
    const { p: pc, doc: c } = provider(r);
    await settle();

    const results = await Promise.all([pa.canSeed(), pb.canSeed(), pc.canSeed()]);
    const ids = [a.clientID, b.clientID, c.clientID];
    const lowest = Math.min(...ids);
    expect(results).toEqual(ids.map((id) => id === lowest));
  });

  it("a peer joining AFTER the room already has content is unaffected — no seed race at all", async () => {
    // The common, non-racy case: this is what actually happens on every ordinary page open
    // after the first. Included so the fix's scope stays visible: canSeed() only ever matters
    // for a genuinely empty room, never for adopting an already-settled peer's real content.
    const r = room();
    const { doc: a } = provider(r);
    a.getText("mdx").insert(0, "already seeded content");

    const { p: pb, doc: b } = provider(r);
    await new Promise((resolve) => setTimeout(resolve, 50)); // let the hello/state handshake land
    expect(b.getText("mdx").toString()).toBe("already seeded content");
    // canSeed() would say true here (B saw no lower peer via hello) — but useCollabDoc never
    // calls it, because ytext.length is already non-zero by the time onSynced fires.
    void pb;
  });
});

describe("isLowestClientId (pure core shared by both transports' canSeed)", () => {
  it("true when no other client is visible", () => {
    expect(isLowestClientId(5, [])).toBe(true);
  });

  it("true when this client's id is lower than every other visible id", () => {
    expect(isLowestClientId(5, [10, 20])).toBe(true);
  });

  it("false when a lower id is visible", () => {
    expect(isLowestClientId(5, [1, 10])).toBe(false);
  });

  it("ignores its own id if present in the list (defensive — should never happen in practice)", () => {
    expect(isLowestClientId(5, [5, 10])).toBe(true);
  });

  it("ties never happen in practice (Yjs clientIDs are random), but an exact tie is not treated as a lower id", () => {
    expect(isLowestClientId(5, [5])).toBe(true);
  });
});
