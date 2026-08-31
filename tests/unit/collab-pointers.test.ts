import { describe, it, expect } from "vitest";
import {
  DEFAULT_POINTER_COLOR,
  DEFAULT_POINTER_NAME,
  localPointerState,
  planRemotePointers,
  type PointerViewport,
} from "@/components/editor/visual/pointer-plan";

// Live mouse pointers (SPEC §9.2). The whole feature is arithmetic about somebody else's screen, so
// it's tested here rather than by opening two browsers and squinting: the round trip
// (localPointerState → awareness → planRemotePointers) has to land in the same place relative to
// the TEXT even when the two windows are different sizes and scrolled differently.

/** A 600px-wide content column starting at x=200, in a 400px-tall pane at y=100, unscrolled. */
const viewport: PointerViewport = { left: 200, width: 600, top: 100, scrollTop: 0, height: 400 };

const states = (entries: Record<number, Record<string, unknown>>) =>
  Object.entries(entries).map(([id, s]) => [Number(id), s] as [number, Record<string, unknown>]);

const peer = (xFrac: number, yDoc: number, user?: { name: string; color: string }) => ({
  pointer: { xFrac, yDoc },
  ...(user ? { user } : {}),
});

describe("planRemotePointers", () => {
  it("places a peer's pointer from the fraction and the document y", () => {
    const [p] = planRemotePointers(states({ 2: peer(0.5, 150) }), 1, viewport);
    expect(p.x).toBe(500); // 200 + 0.5 * 600
    expect(p.y).toBe(250); // 100 + 150 - 0
  });

  it("never draws our own pointer — we have a real cursor", () => {
    expect(planRemotePointers(states({ 1: peer(0.5, 10) }), 1, viewport)).toEqual([]);
  });

  it("skips a peer with no pointer published", () => {
    // Three ways this happens, all meaning the same thing: not in the Visual editor, toggle off,
    // or their mouse left the editor.
    expect(planRemotePointers(states({ 2: {} }), 1, viewport)).toEqual([]);
    expect(planRemotePointers(states({ 2: { pointer: null } }), 1, viewport)).toEqual([]);
  });

  it("ignores nonsense coordinates rather than drawing at the origin", () => {
    expect(planRemotePointers(states({ 2: { pointer: { xFrac: NaN, yDoc: 5 } } }), 1, viewport)).toEqual([]);
    expect(planRemotePointers(states({ 2: { pointer: { yDoc: 5 } } }), 1, viewport)).toEqual([]);
    expect(planRemotePointers(states({ 2: { pointer: { xFrac: 0.5 } } }), 1, viewport)).toEqual([]);
    expect(
      planRemotePointers(states({ 2: { pointer: { xFrac: "0.5", yDoc: 5 } } }), 1, viewport),
    ).toEqual([]);
  });

  it("clamps a fraction from a wider window into this column", () => {
    const [a] = planRemotePointers(states({ 2: peer(1.4, 10) }), 1, viewport);
    expect(a.x).toBe(800); // the column's right edge, not past it
    const [b] = planRemotePointers(states({ 2: peer(-0.4, 10) }), 1, viewport);
    expect(b.x).toBe(200);
  });

  it("subtracts our own scroll, so a document position tracks the page", () => {
    const scrolled = { ...viewport, scrollTop: 120 };
    const [p] = planRemotePointers(states({ 2: peer(0, 300) }), 1, scrolled);
    expect(p.y).toBe(280); // 100 + 300 - 120
  });

  it("drops a pointer scrolled out of view", () => {
    // Far above the visible area…
    expect(planRemotePointers(states({ 2: peer(0.5, 0) }), 1, { ...viewport, scrollTop: 900 })).toEqual([]);
    // …and far below it.
    expect(planRemotePointers(states({ 2: peer(0.5, 5000) }), 1, viewport)).toEqual([]);
  });

  it("keeps one just off the edge, so it still reads as 'just above'", () => {
    const [p] = planRemotePointers(states({ 2: peer(0.5, 80) }), 1, { ...viewport, scrollTop: 100 });
    expect(p.y).toBe(80); // 20px above the pane top, inside the slack
  });

  it("takes each peer's name and colour from their presence identity", () => {
    const [p] = planRemotePointers(
      states({ 2: peer(0.5, 10, { name: "Ada", color: "#ec4899" }) }),
      1,
      viewport,
    );
    expect(p.name).toBe("Ada");
    expect(p.color).toBe("#ec4899");
  });

  it("falls back to a generic label rather than an unlabelled arrow", () => {
    const [p] = planRemotePointers(states({ 2: peer(0.5, 10) }), 1, viewport);
    expect(p.name).toBe(DEFAULT_POINTER_NAME);
    expect(p.color).toBe(DEFAULT_POINTER_COLOR);
  });

  it("draws nothing when the column has no width yet (first paint)", () => {
    expect(planRemotePointers(states({ 2: peer(0.5, 10) }), 1, { ...viewport, width: 0 })).toEqual([]);
  });
});

describe("localPointerState", () => {
  it("converts client coordinates into the layout-independent pair", () => {
    expect(localPointerState({ x: 500, y: 250 }, viewport)).toEqual({ xFrac: 0.5, yDoc: 150 });
  });

  it("adds our scroll, so the y is a document position", () => {
    expect(localPointerState({ x: 200, y: 100 }, { ...viewport, scrollTop: 300 })).toEqual({
      xFrac: 0,
      yDoc: 300,
    });
  });

  it("counts a small margin either side as still pointing at the text", () => {
    // 100px left of a 600px column is -0.17 — inside the tolerance, clamped to the edge.
    expect(localPointerState({ x: 100, y: 150 }, viewport)?.xFrac).toBe(0);
  });

  it("publishes nothing when the pointer is well outside the column", () => {
    expect(localPointerState({ x: -400, y: 150 }, viewport)).toBeNull();
    expect(localPointerState({ x: 1600, y: 150 }, viewport)).toBeNull();
  });

  it("round-trips between two differently-sized windows to the same place in the text", () => {
    // Mine: a 600px column at x=200. Theirs: a 900px column at x=50, scrolled 200px down.
    const mine = viewport;
    const theirs: PointerViewport = { left: 50, width: 900, top: 60, scrollTop: 200, height: 500 };

    // I point a quarter of the way across the column, 200px down the document.
    const published = localPointerState({ x: mine.left + 0.25 * mine.width, y: mine.top + 200 }, mine)!;
    const [drawn] = planRemotePointers(states({ 2: { pointer: published } }), 1, theirs);

    // A quarter across THEIR column, and 200px down the document on their screen.
    expect(drawn.x).toBe(theirs.left + 0.25 * theirs.width);
    expect(drawn.y).toBe(theirs.top + 200 - theirs.scrollTop);
  });
});
