// Pure series math for the Usage chart (SPEC §10 Billing) — day × feature stacking,
// axis ticks, compact number formatting. No DB, no React, so it unit-tests in isolation
// (tests/unit/usage-series.test.ts) and the query layer (billing/usage-history.ts) and
// the chart component just consume it.
import { formatDayFull, type DayBucket } from "./analytics-range";

/**
 * The categorical slots, in FIXED order. `slot` indexes the validated series palette
 * (--series-N in platform.css) and is carried on the series itself, so color follows the
 * feature and never its rank — a day range where nobody used the editor agent must not
 * repaint the two survivors.
 *
 * Keys are the `usage_event.feature` strings written by billing/store.ts (`USAGE_FEATURE`),
 * not the entitlement keys.
 */
export const USAGE_SERIES = [
  { key: "assistant", label: "Assistant", slot: 1 },
  { key: "writer", label: "Editor agent", slot: 2 },
  { key: "workflow", label: "Automations", slot: 3 },
] as const;

/** Anything the catalog gains later still charts — folded into one neutral slot rather
 *  than inventing a hue (a generated 4th color is how palettes stop being colorblind-safe). */
const OTHER = { key: "other", label: "Other", slot: 0 };

export function usageFeatureLabel(feature: string): string {
  return USAGE_SERIES.find((s) => s.key === feature)?.label ?? "Other";
}

export interface UsageSeries {
  key: string;
  label: string;
  /** Palette slot (1-3 = the validated hues, 0 = the neutral "Other"). */
  slot: number;
  credits: number;
  /** Share of the window's total, one decimal (49.5). 0 when nothing was used. */
  pct: number;
}

export interface UsageDay {
  key: string;
  /** "Jan 26" — the axis label. */
  label: string;
  /** "Jan 26, 2026" — the tooltip's footer. */
  full: string;
  partial: boolean;
  credits: number;
  /** Per-series credits, index-aligned with `series` (bottom of the stack first). */
  values: number[];
}

export interface UsageChartData {
  series: UsageSeries[];
  days: UsageDay[];
  credits: number;
  /** Axis maximum — a rounded number at or above the tallest day, 0 when there's no data. */
  axisMax: number;
  /** Ascending axis ticks including 0 and `axisMax`. `[0]` when there's no data. */
  ticks: number[];
}

export interface UsageRow {
  /** 'YYYY-MM-DD' local day key, matching DayBucket.key. */
  day: string;
  feature: string;
  credits: number;
}

/** "20.4K" / "1.2M" / "940" — chart-axis and tooltip scale, not the exact ledger number. */
export function formatCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs < 1000) return String(n);
  const [div, suffix] =
    abs < 1e6 ? [1e3, "K"] : abs < 1e9 ? [1e6, "M"] : [1e9, "B"];
  const scaled = n / div;
  // One decimal, but never a bare ".0" — "50K" reads as an axis tick, "50.0K" doesn't.
  const rounded = Math.round(scaled * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}${suffix}`;
}

/**
 * A rounded axis top at or above `max`, with evenly spaced ticks landing on it. Steps
 * snap to 1/2/2.5/5 × 10^k so the labels read as round numbers (10K, 20K…) rather than
 * as the data's own maximum.
 */
export function niceAxis(max: number, tickCount = 5): { max: number; ticks: number[] } {
  if (!(max > 0)) return { max: 0, ticks: [0] };
  const rough = max / tickCount;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step =
    magnitude *
    ([1, 2, 2.5, 5, 10].find((m) => m * magnitude >= rough) ?? 10);
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let t = 0; t <= top + step / 2; t += step) {
    // Float steps (2.5 × 10^k) accumulate error; round to the step's own precision.
    ticks.push(Math.round(t * 1e6) / 1e6);
  }
  return { max: top, ticks };
}

/**
 * Stack sparse `{ day, feature, credits }` aggregates onto the dense day buckets.
 * Series with no usage in the window are dropped (a legend row reading "0 · 0.0%" is
 * noise) — their slot stays reserved, so the colors of the ones that remain don't move.
 */
export function buildUsageSeries(
  buckets: DayBucket[],
  rows: UsageRow[],
): UsageChartData {
  const perSeries = new Map<string, number>();
  // day key -> series key -> credits
  const perDay = new Map<string, Map<string, number>>();
  // A row outside the bucket list has no bar to land in, so it's out of the legend too —
  // the totals under the chart always add up to the bars above them.
  const inWindow = new Set(buckets.map((b) => b.key));

  for (const row of rows) {
    if (!inWindow.has(row.day)) continue;
    const key = USAGE_SERIES.some((s) => s.key === row.feature)
      ? row.feature
      : OTHER.key;
    perSeries.set(key, (perSeries.get(key) ?? 0) + row.credits);
    const day = perDay.get(row.day) ?? new Map<string, number>();
    day.set(key, (day.get(key) ?? 0) + row.credits);
    perDay.set(row.day, day);
  }

  const series: UsageSeries[] = [...USAGE_SERIES, OTHER]
    .filter((s) => (perSeries.get(s.key) ?? 0) > 0)
    .map((s) => ({ ...s, credits: perSeries.get(s.key) ?? 0, pct: 0 }));

  const credits = series.reduce((sum, s) => sum + s.credits, 0);
  for (const s of series) {
    s.pct = credits > 0 ? Math.round((s.credits / credits) * 1000) / 10 : 0;
  }

  const days: UsageDay[] = buckets.map((b) => {
    const day = perDay.get(b.key);
    const values = series.map((s) => day?.get(s.key) ?? 0);
    return {
      key: b.key,
      label: b.label,
      full: formatDayFull(b.date),
      partial: b.partial,
      credits: values.reduce((sum, v) => sum + v, 0),
      values,
    };
  });

  const { max: axisMax, ticks } = niceAxis(
    Math.max(0, ...days.map((d) => d.credits)),
  );

  return { series, days, credits, axisMax, ticks };
}
