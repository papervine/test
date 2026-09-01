import { describe, expect, it } from "vitest";
import { hexToRgb01, toPx } from "@/components/platform/PrismaticBurst";

// The burst itself needs a GPU, so what's testable here is what feeds its uniforms: the two pure
// converters. Both matter more than they look — a NaN in a WebGL uniform doesn't throw, it renders
// a black rectangle over the login form, and a mis-parsed colour silently prints the wrong brand.

describe("hexToRgb01", () => {
  it("parses six-digit hex", () => {
    expect(hexToRgb01("#000000")).toEqual([0, 0, 0]);
    expect(hexToRgb01("#ffffff")).toEqual([1, 1, 1]);
    const [r, g, b] = hexToRgb01("#5b8cff");
    expect(r).toBeCloseTo(0x5b / 255);
    expect(g).toBeCloseTo(0x8c / 255);
    expect(b).toBeCloseTo(0xff / 255);
  });

  it("expands three-digit hex and tolerates a missing #, whitespace and case", () => {
    expect(hexToRgb01("#f00")).toEqual(hexToRgb01("#ff0000"));
    expect(hexToRgb01("5B8CFF")).toEqual(hexToRgb01("#5b8cff"));
    expect(hexToRgb01("  #a974ff  ")).toEqual(hexToRgb01("#a974ff"));
  });

  it("falls back to white rather than NaN on anything it can't read", () => {
    // NaN in the gradient texture is a black backdrop, not an error — so unparseable input has to
    // resolve to a real colour.
    for (const bad of ["", "#", "nope", "rgb(1,2,3)", "#12345"]) {
      const rgb = hexToRgb01(bad);
      expect(rgb.every((c) => Number.isFinite(c)), `${bad} produced NaN`).toBe(true);
      expect(rgb).toEqual([1, 1, 1]);
    }
  });

  it("reads the platform palette the auth backdrop is built from", () => {
    for (const color of ["#261B62", "#5b8cff", "#a974ff", "#BDA4F1"]) {
      const rgb = hexToRgb01(color);
      expect(rgb.every((c) => c >= 0 && c <= 1)).toBe(true);
      expect(rgb).not.toEqual([1, 1, 1]); // i.e. it parsed, rather than falling back
    }
  });
});

describe("toPx", () => {
  it("passes numbers through and parses px strings", () => {
    expect(toPx(0)).toBe(0);
    expect(toPx(-120)).toBe(-120);
    expect(toPx("40px")).toBe(40);
    expect(toPx(" -12.5px ")).toBe(-12.5);
  });

  it("is 0 for nothing, and never NaN or Infinity", () => {
    for (const v of [null, undefined, "", "auto", "50%x", NaN, Infinity]) {
      const px = toPx(v as number | string | null | undefined);
      expect(Number.isFinite(px), `${String(v)} produced ${px}`).toBe(true);
    }
    expect(toPx(null)).toBe(0);
    expect(toPx("auto")).toBe(0);
  });
});
