import { describe, it, expect } from "vitest";
import { partOfDay, parseFeedTarget } from "../../src/lib/overview";

describe("partOfDay", () => {
  it("splits the day into morning / afternoon / evening", () => {
    expect(partOfDay(0)).toBe("morning");
    expect(partOfDay(11)).toBe("morning");
    expect(partOfDay(12)).toBe("afternoon");
    expect(partOfDay(17)).toBe("afternoon");
    expect(partOfDay(18)).toBe("evening");
    expect(partOfDay(23)).toBe("evening");
  });
});

describe("parseFeedTarget", () => {
  it("maps the Previews tab to the preview target", () => {
    expect(parseFeedTarget("previews")).toBe("preview");
  });

  it("defaults to Live for missing or unknown params", () => {
    expect(parseFeedTarget(undefined)).toBe("live");
    expect(parseFeedTarget("live")).toBe("live");
    expect(parseFeedTarget("garbage")).toBe("live");
  });
});
