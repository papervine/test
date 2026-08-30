import { describe, expect, it } from "vitest";

import {
  fallKeyframes,
  fallWindow,
  lifeKeyframes,
  simulateLeafFall,
} from "../../src/lib/leaf-fall";

// The landing page's falling leaves are a physics simulation baked into CSS keyframes on the
// server. What's worth pinning isn't the exact path — it's the properties that make it read as
// a leaf and not a stone or a glitch: it reaches the floor in a watchable time, it never speeds
// past a leafy terminal velocity, it drifts rather than shooting sideways, it settles into a
// wobble rather than spinning forever, and the same seed gives the same fall on every render
// (SSR would otherwise mismatch).

// The nine leaves VineField grows, approximately: three vines, heights across the whole frame.
const LEAVES = [93, 174, 332, 381, 597, 643].flatMap((y, i) =>
  [0, 1, 2].map((k) => ({ seed: i * 3 + k, blade: [58, -30, 48][k], startY: y, floorY: 900 })),
);

describe("simulateLeafFall", () => {
  it("is deterministic for a seed — SSR renders the same fall as the client", () => {
    const a = simulateLeafFall(LEAVES[0]);
    const b = simulateLeafFall(LEAVES[0]);
    expect(b).toEqual(a);
    // …and a different seed is a different leaf.
    expect(simulateLeafFall({ ...LEAVES[0], seed: 99 })).not.toEqual(a);
  });

  it("reaches the floor, and takes a leaf's time about it", () => {
    for (const leaf of LEAVES) {
      const s = simulateLeafFall(leaf);
      const last = s[s.length - 1];
      const drop = leaf.floorY - leaf.startY;
      expect(leaf.startY + last.y, `seed ${leaf.seed} left the frame`).toBeGreaterThanOrEqual(leaf.floorY);
      // Slower than free fall by a wide margin (free fall over 800px at 520px/s² is ~1.75s), but
      // not so slow it hangs in the air. Average speed between 45 and 130 px/s.
      const avg = drop / last.t;
      expect(avg, `seed ${leaf.seed} average speed`).toBeGreaterThan(45);
      expect(avg, `seed ${leaf.seed} average speed`).toBeLessThan(130);
    }
  });

  it("never exceeds a leafy terminal velocity", () => {
    for (const leaf of LEAVES) {
      const s = simulateLeafFall(leaf);
      for (let i = 1; i < s.length; i++) {
        const v = Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y) / (s[i].t - s[i - 1].t);
        expect(v, `seed ${leaf.seed} at t=${s[i].t.toFixed(2)}`).toBeLessThan(200);
      }
    }
  });

  it("drifts sideways rather than shooting off, and never climbs back up the vine", () => {
    for (const leaf of LEAVES) {
      const s = simulateLeafFall(leaf);
      const xs = s.map((p) => Math.abs(p.x));
      // A long fall may wander a good way (wind + glide) but stays inside the composition.
      expect(Math.max(...xs), `seed ${leaf.seed} drift`).toBeLessThan(380);
      // Lift can lift, but not above where it let go — that would read as floating up.
      expect(Math.min(...s.map((p) => p.y)), `seed ${leaf.seed} rose`).toBeGreaterThanOrEqual(-8);
    }
  });

  it("samples densely enough to interpolate, and only ever forward in time", () => {
    for (const leaf of LEAVES) {
      const s = simulateLeafFall(leaf);
      expect(s.length).toBeGreaterThan(10);
      for (let i = 1; i < s.length; i++) expect(s[i].t).toBeGreaterThan(s[i - 1].t);
      // Rotation is continuous — CSS interpolates `rotate()` numerically, so a wrapped angle
      // (−179° → 179°) would spin the leaf the long way round between two keyframes. A tumbler
      // can legitimately turn most of a half-turn between 8 Hz samples; a wrap is a full one.
      for (let i = 1; i < s.length; i++) {
        expect(Math.abs(s[i].rot - s[i - 1].rot), `seed ${leaf.seed} rotation jump`).toBeLessThan(180);
      }
    }
  });
});

describe("fallWindow + keyframes", () => {
  it("makes room for a long fall by releasing earlier, but never before the leaf has grown", () => {
    expect(fallWindow(3, 30)).toEqual({ release: 68, end: 78 });
    // 12s out of a 24s cycle is half of it: release moves back to leave a pause after.
    const long = fallWindow(12, 24);
    expect(long.release).toBe(46);
    expect(long.end).toBe(96);
    // Absurdly long: clamped, and the end never overruns the cycle.
    const clamped = fallWindow(40, 20);
    expect(clamped.release).toBe(30);
    expect(clamped.end).toBeLessThanOrEqual(99);
  });

  it("writes valid, monotonic keyframes that hold still until release and stay opaque through the fall", () => {
    const s = simulateLeafFall(LEAVES[0]);
    const w = fallWindow(s[s.length - 1].t, 27);
    const fall = fallKeyframes("f", s, w);
    const life = lifeKeyframes("l", w);

    expect(fall.startsWith("@keyframes f{0%,")).toBe(true);
    expect(fall).toContain("transform:none");
    expect(fall.endsWith("}}")).toBe(true);
    const pcts = [...fall.matchAll(/(\d+(?:\.\d+)?)%\{/g)].map((m) => Number(m[1]));
    for (let i = 1; i < pcts.length; i++) expect(pcts[i]).toBeGreaterThanOrEqual(pcts[i - 1]);
    expect(pcts[pcts.length - 1]).toBe(100);

    // Opaque at the end of the fall; dark only after it.
    expect(life).toContain(`${w.end}%{opacity:1`);
    expect(life).toMatch(/,100%\{opacity:0/);
    expect(life).not.toContain("translate"); // the life never moves the leaf — the fall does
  });
});
