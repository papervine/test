import { describe, expect, it } from "vitest";

import {
  filterIcons,
  ICON_NAMES,
  toKebabIcon,
} from "../../src/components/editor/visual/icon-names";

// The icon picker's vocabulary. What matters here isn't the list — it comes from lucide-react, so
// asserting its contents would just re-state the library — but that the names it offers are the
// ones `LucideIcon` can resolve. It title-cases a kebab name to find the export, so a name this
// module produces in any other shape renders NOTHING on the page (LucideIcon returns null for an
// unknown name, deliberately: an icon typo must never break a page, which also means it can't
// report one).

const toPascal = (kebab: string) =>
  kebab
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");

describe("toKebabIcon", () => {
  it("round-trips through LucideIcon's own title-casing", () => {
    expect(toKebabIcon("CircleCheck")).toBe("circle-check");
    expect(toKebabIcon("Rocket")).toBe("rocket");
    // Runs of capitals stay together: QrCode, not q-r-code.
    expect(toKebabIcon("QrCode")).toBe("qr-code");
    // Digits belong to the word before them, the way Lucide names them.
    expect(toKebabIcon("Volume2")).toBe("volume2");
  });

  it("produces a name that resolves back to its export, for every icon", () => {
    const wrong = ICON_NAMES.filter((name) => toKebabIcon(toPascal(name)) !== name);
    expect(wrong).toEqual([]);
  });
});

describe("filterIcons", () => {
  it("returns a capped page of the library when the query is empty", () => {
    expect(ICON_NAMES.length).toBeGreaterThan(500);
    expect(filterIcons("")).toHaveLength(120);
    expect(filterIcons("", 8)).toHaveLength(8);
  });

  it("leads with prefix matches, then substring ones", () => {
    const hits = filterIcons("check");
    expect(hits).toContain("check");
    expect(hits.indexOf("check")).toBeLessThan(hits.indexOf("book-check"));
  });

  it("is case- and space-insensitive, matching the kebab names authors write", () => {
    expect(filterIcons("Circle Check")).toContain("circle-check");
    expect(filterIcons("CIRCLE-CHECK")).toContain("circle-check");
  });

  it("returns nothing rather than everything for a query that matches nothing", () => {
    expect(filterIcons("nothinglikethisicon")).toEqual([]);
  });
});
