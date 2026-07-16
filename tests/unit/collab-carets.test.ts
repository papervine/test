import { describe, it, expect } from "vitest";
import {
  planRemoteCarets,
  rgba,
  DEFAULT_CARET_COLOR,
  DEFAULT_CARET_NAME,
} from "@/components/editor/visual/caret-plan";

// The Visual editor renders each collaborator's cursor from awareness. planRemoteCarets is the pure
// decision layer (CollabCarets maps its output onto ProseMirror decorations); these tests pin the
// behaviour that must hold for carets to be correct — self-filtering, doc-bounds clamping, and the
// selection-band-vs-bare-caret split. See src/components/editor/visual/CollabCarets.ts.

type State = Record<string, unknown>;
const states = (entries: Array<[number, State]>): Iterable<[number, State]> => entries;
const peer = (head: number, anchor = head, user?: { name?: string; color?: string }): State => ({
  visualCursor: { head, anchor },
  ...(user ? { user } : {}),
});

describe("planRemoteCarets", () => {
  it("does not draw a caret for our own client", () => {
    const out = planRemoteCarets(states([[1, peer(3)]]), 1, 100);
    expect(out).toEqual([]);
  });

  it("draws a caret for a remote client at its head", () => {
    const out = planRemoteCarets(states([[2, peer(7, 7, { name: "Otter", color: "#6366f1" })]]), 1, 100);
    expect(out).toEqual([{ clientId: 2, color: "#6366f1", name: "Otter", head: 7, selection: null }]);
  });

  it("skips a present peer that has no visualCursor (e.g. a Source-mode peer)", () => {
    const out = planRemoteCarets(states([[2, { user: { name: "Otter" } }]]), 1, 100);
    expect(out).toEqual([]);
  });

  it("skips a peer whose visualCursor.head is not a number", () => {
    const out = planRemoteCarets(states([[2, { visualCursor: { head: null, anchor: 0 } }]]), 1, 100);
    expect(out).toEqual([]);
  });

  it("emits a selection band (from<to) plus a caret when the selection is non-empty", () => {
    const out = planRemoteCarets(states([[2, peer(9, 4)]]), 1, 100);
    expect(out[0].selection).toEqual({ from: 4, to: 9 });
    expect(out[0].head).toBe(9);
  });

  it("normalizes a backwards selection so from<=to", () => {
    const out = planRemoteCarets(states([[2, peer(4, 9)]]), 1, 100); // head before anchor
    expect(out[0].selection).toEqual({ from: 4, to: 9 });
    expect(out[0].head).toBe(4); // caret stays at head
  });

  it("clamps positions into [0, docSize] so a stale off-the-end cursor can't escape the doc", () => {
    const out = planRemoteCarets(states([[2, peer(500, -20)]]), 1, 50);
    expect(out[0].head).toBe(50);
    expect(out[0].selection).toEqual({ from: 0, to: 50 });
  });

  it("collapses to a bare caret (no band) when clamping makes anchor==head", () => {
    // Both anchor and head are past the end → clamp both to docSize → empty selection.
    const out = planRemoteCarets(states([[2, peer(80, 90)]]), 1, 50);
    expect(out[0].selection).toBeNull();
    expect(out[0].head).toBe(50);
  });

  it("falls back to default name/colour when the peer has no user identity", () => {
    const out = planRemoteCarets(states([[2, peer(1)]]), 1, 100);
    expect(out[0]).toMatchObject({ color: DEFAULT_CARET_COLOR, name: DEFAULT_CARET_NAME });
  });

  it("renders every remote client, each keyed by its own clientId", () => {
    const out = planRemoteCarets(
      states([
        [1, peer(1)], // self — excluded
        [2, peer(2)],
        [3, peer(3, 5)],
      ]),
      1,
      100,
    );
    expect(out.map((c) => c.clientId)).toEqual([2, 3]);
  });
});

describe("rgba", () => {
  it("expands a 6-digit hex to rgba with the given alpha", () => {
    expect(rgba("#6366f1", 0.22)).toBe("rgba(99, 102, 241, 0.22)");
  });
  it("accepts a hex without the leading #", () => {
    expect(rgba("10b981", 0.5)).toBe("rgba(16, 185, 129, 0.5)");
  });
  it("returns the input unchanged when it isn't a 6-digit hex (never throws)", () => {
    expect(rgba("rebeccapurple", 0.3)).toBe("rebeccapurple");
    expect(rgba("#abc", 0.3)).toBe("#abc");
  });
});
