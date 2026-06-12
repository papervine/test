import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  formatDurationMs,
  partOfDay,
  parseFeedTarget,
  triggerDetail,
  triggerLabel,
} from "../../src/lib/overview";

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
  it("does not compute the greeting from server time in the site overview page", () => {
    const page = read("../../src/app/app/[org]/[site]/page.tsx");
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

describe("formatDurationMs", () => {
  it("uses ms under a second", () => {
    expect(formatDurationMs(0)).toBe("0ms");
    expect(formatDurationMs(412)).toBe("412ms");
  });
  it("uses one-decimal seconds under a minute, dropping a trailing .0", () => {
    expect(formatDurationMs(1409)).toBe("1.4s");
    expect(formatDurationMs(3000)).toBe("3s");
    expect(formatDurationMs(59_940)).toBe("59.9s");
  });
  it("uses m + zero-padded s from a minute up", () => {
    expect(formatDurationMs(60_000)).toBe("1m 00s");
    expect(formatDurationMs(125_000)).toBe("2m 05s");
  });
});

describe("triggerLabel (feed byline)", () => {
  it("labels webhook syncs as GitHub push, never Manual Update", () => {
    expect(triggerLabel("webhook", null)).toBe("GitHub push");
  });
  it("prefers the actor's name for connect/manual syncs", () => {
    expect(triggerLabel("manual", "Jeff Loiselle")).toBe("Jeff Loiselle");
    expect(triggerLabel("connect", "Jeff Loiselle")).toBe("Jeff Loiselle");
  });
  it("keeps the legacy fallback for pre-column rows", () => {
    expect(triggerLabel(null, null)).toBe("Manual Update");
  });
});

describe("triggerDetail (expanded panel)", () => {
  it("describes each trigger mechanism", () => {
    expect(triggerDetail("webhook")).toBe("GitHub push (auto-sync)");
    expect(triggerDetail("manual")).toBe("Manual re-sync");
    expect(triggerDetail("connect")).toBe("Repository connected");
    expect(triggerDetail(null)).toBe("—");
  });
});
