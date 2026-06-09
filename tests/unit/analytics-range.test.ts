import { describe, it, expect } from "vitest";
import {
  parseRangeKey,
  resolveRange,
  formatRangeLabel,
  computeDelta,
  dayBuckets,
  fillSeries,
  dayKey,
} from "@/lib/analytics-range";

// Fixed "now" so every assertion is deterministic — Sun Jun 8 2026, 14:30 local.
const NOW = new Date(2026, 5, 8, 14, 30, 0);

describe("parseRangeKey", () => {
  it("accepts known keys", () => {
    expect(parseRangeKey("30d")).toBe("30d");
    expect(parseRangeKey("90d")).toBe("90d");
  });
  it("falls back to the default for garbage/empty", () => {
    expect(parseRangeKey("nonsense")).toBe("7d");
    expect(parseRangeKey(null)).toBe("7d");
    expect(parseRangeKey(undefined)).toBe("7d");
  });
});

describe("resolveRange", () => {
  it("spans `days` buckets ending today, with today's bucket partial", () => {
    const r = resolveRange("7d", NOW);
    expect(r.days).toBe(7);
    // start is 00:00 of Jun 2 (today − 6 days); end is exactly now (today partial).
    expect(r.start).toEqual(new Date(2026, 5, 2));
    expect(r.end).toEqual(NOW);
    expect(r.lastDay).toEqual(new Date(2026, 5, 8));
  });

  it("places the previous window immediately before, same length", () => {
    const r = resolveRange("7d", NOW);
    expect(r.prevEnd).toEqual(r.start);
    expect(r.prevStart).toEqual(new Date(2026, 4, 26)); // May 26
  });

  it("labels the range", () => {
    expect(resolveRange("7d", NOW).label).toBe("Jun 2 – 8");
  });
});

describe("formatRangeLabel", () => {
  it("omits the month on the right when same month", () => {
    expect(formatRangeLabel(new Date(2026, 5, 1), new Date(2026, 5, 8))).toBe(
      "Jun 1 – 8",
    );
  });
  it("shows both months when they differ", () => {
    expect(formatRangeLabel(new Date(2026, 4, 9), new Date(2026, 5, 8))).toBe(
      "May 9 – Jun 8",
    );
  });
});

describe("computeDelta", () => {
  it("returns null with no prior baseline (avoids divide-by-zero)", () => {
    expect(computeDelta(27, 0)).toBeNull();
  });
  it("computes up/down/flat percentages", () => {
    expect(computeDelta(10, 5)).toEqual({ pct: 100, dir: "up" });
    expect(computeDelta(5, 10)).toEqual({ pct: -50, dir: "down" });
    expect(computeDelta(10, 10)).toEqual({ pct: 0, dir: "flat" });
  });
});

describe("dayBuckets + fillSeries", () => {
  it("produces a dense, ordered series with today marked partial", () => {
    const buckets = dayBuckets(resolveRange("7d", NOW));
    expect(buckets).toHaveLength(7);
    expect(buckets[0].key).toBe("2026-06-02");
    expect(buckets[6].key).toBe("2026-06-08");
    expect(buckets[6].partial).toBe(true);
    expect(buckets[0].partial).toBe(false);
  });

  it("merges sparse counts onto the dense buckets (missing = 0)", () => {
    const buckets = dayBuckets(resolveRange("7d", NOW));
    const filled = fillSeries(
      buckets,
      new Map([
        ["2026-06-02", 4],
        ["2026-06-08", 9],
      ]),
    );
    expect(filled.map((d) => d.count)).toEqual([4, 0, 0, 0, 0, 0, 9]);
  });
});

describe("dayKey", () => {
  it("formats a local YYYY-MM-DD with zero padding", () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});
