import { describe, it, expect } from "vitest";
import { slugify } from "@/lib/slug";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Acme Inc")).toBe("acme-inc");
  });
  it("collapses runs of non-alphanumerics", () => {
    expect(slugify("Hello,   World!! 2")).toBe("hello-world-2");
  });
  it("trims leading/trailing separators", () => {
    expect(slugify("  --Pixwel--  ")).toBe("pixwel");
  });
  it("handles empty/garbage input", () => {
    expect(slugify("")).toBe("");
    expect(slugify("!!!")).toBe("");
  });
});
