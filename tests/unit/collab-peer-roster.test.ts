import { describe, it, expect } from "vitest";
import { peersFromStates, rosterKey } from "@/components/editor/collab/peer-roster";

// Regression net for the "Maximum update depth exceeded" navigation loop: the Hocuspocus transport
// wires Yjs awareness "change" → React setState, but awareness fires on every cursor move (CollabCarets
// writes a `visualCursor` field). If a cursor-only change looked like a roster change, every keystroke
// would re-render — and under a route transition that compounds into an infinite update loop. These
// pin that the roster (and its dedupe key) depend ONLY on `user` identity, never on `visualCursor`.

type State = Record<string, unknown>;
const states = (e: Array<[number, State]>): Iterable<[number, State]> => e;
const withUser = (name: string, color: string, extra?: State): State => ({ user: { name, color }, ...extra });

describe("peersFromStates", () => {
  it("excludes our own client", () => {
    const out = peersFromStates(states([[1, withUser("Me", "#000")]]), 1);
    expect(out).toEqual([]);
  });

  it("includes remote clients that have published a user identity", () => {
    const out = peersFromStates(states([[2, withUser("Otter", "#6366f1")]]), 1);
    expect(out).toEqual([{ clientId: 2, name: "Otter", color: "#6366f1" }]);
  });

  it("skips a present client that has no user identity yet (connected, not announced)", () => {
    const out = peersFromStates(states([[2, { visualCursor: { head: 3, anchor: 3 } }]]), 1);
    expect(out).toEqual([]);
  });
});

describe("rosterKey (dedupe key)", () => {
  it("is INVARIANT to visualCursor changes — the core of the nav-loop fix", () => {
    const before = states([[2, withUser("Otter", "#6366f1", { visualCursor: { head: 1, anchor: 1 } })]]);
    const after = states([[2, withUser("Otter", "#6366f1", { visualCursor: { head: 99, anchor: 40 } })]]);
    // Same person, cursor moved a lot → identical roster → identical key → no React re-render.
    expect(rosterKey(peersFromStates(before, 1))).toBe(rosterKey(peersFromStates(after, 1)));
  });

  it("is independent of client ordering", () => {
    const a = peersFromStates(states([[2, withUser("Otter", "#6366f1")], [3, withUser("Wren", "#10b981")]]), 1);
    const b = peersFromStates(states([[3, withUser("Wren", "#10b981")], [2, withUser("Otter", "#6366f1")]]), 1);
    expect(rosterKey(a)).toBe(rosterKey(b));
  });

  it("CHANGES when a peer joins", () => {
    const one = peersFromStates(states([[2, withUser("Otter", "#6366f1")]]), 1);
    const two = peersFromStates(states([[2, withUser("Otter", "#6366f1")], [3, withUser("Wren", "#10b981")]]), 1);
    expect(rosterKey(one)).not.toBe(rosterKey(two));
  });

  it("CHANGES when a peer renames or recolors", () => {
    const base = rosterKey(peersFromStates(states([[2, withUser("Otter", "#6366f1")]]), 1));
    const renamed = rosterKey(peersFromStates(states([[2, withUser("Otter II", "#6366f1")]]), 1));
    const recolored = rosterKey(peersFromStates(states([[2, withUser("Otter", "#ec4899")]]), 1));
    expect(renamed).not.toBe(base);
    expect(recolored).not.toBe(base);
  });

  it("an empty roster has a key distinct from the transport's initial sentinel", () => {
    // HocuspocusTransport seeds lastRosterKey with " " so the very first empty roster still emits
    // once; the empty-roster key must not collide with that sentinel.
    expect(rosterKey([])).toBe("");
    expect(rosterKey([])).not.toBe(" ");
  });
});
