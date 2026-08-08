import { describe, it, expect } from "vitest";
import { siteMarkGradient } from "@/lib/site-mark";

describe("siteMarkGradient", () => {
  it("returns a CSS linear-gradient", () => {
    const g = siteMarkGradient("starter");
    expect(g).toMatch(/^linear-gradient\(135deg, hsl\(\d+ \d+% \d+%\), hsl\(\d+ \d+% \d+%\)\)$/);
  });

  it("is deterministic for the same key (stable across server/client)", () => {
    expect(siteMarkGradient("redux")).toBe(siteMarkGradient("redux"));
  });

  it("gives different keys different hues (the whole point — no more identical chips)", () => {
    const hue = (g: string) => g.match(/hsl\((\d+)/)![1];
    const hues = ["starter", "acme-platform", "redux", "docs"].map((k) =>
      hue(siteMarkGradient(k)),
    );
    expect(new Set(hues).size).toBe(hues.length);
  });
});
