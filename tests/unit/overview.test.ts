import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

describe("greeting time source", () => {
  const read = (rel: string) =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

  // The greeting's part-of-day must come from the reader's clock, not the server's
  // (UTC on Vercel) — else an evening visitor gets "Good morning". The dashboard page
  // is server-rendered, so it must NOT call getHours()/new Date() for the greeting;
  // that belongs in the "use client" <Greeting> component.
  it("does not compute the greeting from server time in the dashboard page", () => {
    const page = read("../../src/app/(app)/dashboard/page.tsx");
    expect(page).not.toMatch(/getHours/);
    expect(page).toContain("<Greeting");
  });

  it("computes part-of-day on the client in <Greeting>", () => {
    const greeting = read("../../src/components/app/Greeting.tsx");
    expect(greeting).toContain('"use client"');
    expect(greeting).toMatch(/partOfDay\(new Date\(\)\.getHours\(\)\)/);
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
