import { describe, it, expect } from "vitest";
import { dayBuckets, resolveRange } from "@/lib/analytics-range";
import {
  buildUsageSeries,
  formatCompact,
  niceAxis,
  usageFeatureLabel,
  type UsageRow,
} from "@/lib/usage-series";

// Fixed "now" so every assertion is deterministic — Wed Jan 28 2026, 09:00 local.
const NOW = new Date(2026, 0, 28, 9, 0, 0);
const BUCKETS = dayBuckets(resolveRange("7d", NOW)); // Jan 22 → Jan 28

describe("formatCompact", () => {
  it("leaves sub-thousands alone", () => {
    expect(formatCompact(0)).toBe("0");
    expect(formatCompact(940)).toBe("940");
  });
  it("uses one decimal, but never a bare .0", () => {
    expect(formatCompact(20_400)).toBe("20.4K");
    expect(formatCompact(50_000)).toBe("50K");
    expect(formatCompact(1_250_000)).toBe("1.3M");
  });
});

describe("niceAxis", () => {
  it("rounds the top up to a round step above the data", () => {
    const { max, ticks } = niceAxis(47_300);
    expect(max).toBe(50_000);
    expect(ticks).toEqual([0, 10_000, 20_000, 30_000, 40_000, 50_000]);
  });

  it("never puts the axis top below the tallest value", () => {
    for (const v of [1, 7, 12, 99, 101, 1234, 87_654]) {
      const { max, ticks } = niceAxis(v);
      expect(max).toBeGreaterThanOrEqual(v);
      expect(ticks.at(-1)).toBe(max);
      expect(ticks[0]).toBe(0);
    }
  });

  it("has no axis to draw for an empty window", () => {
    expect(niceAxis(0)).toEqual({ max: 0, ticks: [0] });
  });

  it("keeps 2.5×10^k steps free of float dust", () => {
    // 2.5-steps are the case where naive accumulation yields 7500.000000000001.
    const { ticks } = niceAxis(11_000, 5);
    expect(ticks.every((t) => Number.isInteger(t))).toBe(true);
  });
});

describe("usageFeatureLabel", () => {
  it("names the recorded feature strings, not the entitlement keys", () => {
    expect(usageFeatureLabel("assistant")).toBe("Assistant");
    expect(usageFeatureLabel("writer")).toBe("Editor agent");
    expect(usageFeatureLabel("workflow")).toBe("Automations");
  });
  it("folds anything unrecognized into Other", () => {
    expect(usageFeatureLabel("something-new")).toBe("Other");
  });
});

describe("buildUsageSeries", () => {
  const rows: UsageRow[] = [
    { day: "2026-01-23", feature: "assistant", credits: 300 },
    { day: "2026-01-23", feature: "writer", credits: 100 },
    { day: "2026-01-26", feature: "assistant", credits: 100 },
    { day: "2026-01-26", feature: "workflow", credits: 500 },
  ];

  it("fills every day in the window, zero where there was no usage", () => {
    const d = buildUsageSeries(BUCKETS, rows);
    expect(d.days).toHaveLength(7);
    expect(d.days.map((x) => x.credits)).toEqual([0, 400, 0, 0, 600, 0, 0]);
    // Today's bucket is the last one and is flagged partial (still filling).
    expect(d.days.at(-1)?.partial).toBe(true);
    expect(d.days[0].partial).toBe(false);
  });

  it("labels days for the axis and, with the year, for the tooltip", () => {
    const d = buildUsageSeries(BUCKETS, rows);
    expect(d.days[1].label).toBe("Jan 23");
    expect(d.days[1].full).toBe("Jan 23, 2026");
  });

  it("totals each series and its share of the window", () => {
    const d = buildUsageSeries(BUCKETS, rows);
    expect(d.credits).toBe(1000);
    expect(d.series.map((s) => [s.key, s.credits, s.pct])).toEqual([
      ["assistant", 400, 40],
      ["writer", 100, 10],
      ["workflow", 500, 50],
    ]);
  });

  it("stacks each day index-aligned with the series list", () => {
    const d = buildUsageSeries(BUCKETS, rows);
    // Jan 23: assistant 300, writer 100, workflow 0.
    expect(d.days[1].values).toEqual([300, 100, 0]);
    // Jan 26: assistant 100, writer 0, workflow 500.
    expect(d.days[4].values).toEqual([100, 0, 500]);
  });

  it("keeps a series' palette slot when the others drop out", () => {
    // The regression this guards: color must follow the FEATURE, so a window where only
    // the editor agent ran still paints it slot 2 rather than promoting it to slot 1.
    const only = buildUsageSeries(BUCKETS, [
      { day: "2026-01-23", feature: "writer", credits: 42 },
    ]);
    expect(only.series).toHaveLength(1);
    expect(only.series[0]).toMatchObject({ key: "writer", slot: 2 });
    const all = buildUsageSeries(BUCKETS, rows);
    expect(all.series.map((s) => s.slot)).toEqual([1, 2, 3]);
  });

  it("folds an unknown feature into one neutral Other series", () => {
    const d = buildUsageSeries(BUCKETS, [
      { day: "2026-01-23", feature: "assistant", credits: 10 },
      { day: "2026-01-23", feature: "translate", credits: 20 },
      { day: "2026-01-24", feature: "summarize", credits: 70 },
    ]);
    expect(d.series.map((s) => s.key)).toEqual(["assistant", "other"]);
    expect(d.series[1]).toMatchObject({ label: "Other", slot: 0, credits: 90 });
    // Other sorts last so an unnamed bucket can't sit under a named one.
    expect(d.days[1].values).toEqual([10, 20]);
  });

  it("scales the axis off the tallest DAY, not the window total", () => {
    const d = buildUsageSeries(BUCKETS, rows);
    expect(d.axisMax).toBe(600);
    expect(d.ticks.at(-1)).toBe(600);
  });

  it("reports an empty window without an axis or series", () => {
    const d = buildUsageSeries(BUCKETS, []);
    expect(d.credits).toBe(0);
    expect(d.series).toEqual([]);
    expect(d.axisMax).toBe(0);
    expect(d.days.every((x) => x.credits === 0 && x.values.length === 0)).toBe(true);
  });

  it("drops rows outside the window so the legend adds up to the bars", () => {
    const d = buildUsageSeries(BUCKETS, [
      { day: "2025-12-01", feature: "assistant", credits: 999 },
      { day: "2026-01-23", feature: "assistant", credits: 10 },
    ]);
    expect(d.days).toHaveLength(7);
    expect(d.credits).toBe(10);
    expect(d.days.reduce((sum, x) => sum + x.credits, 0)).toBe(d.credits);
  });
});
