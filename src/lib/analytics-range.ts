// Pure date-range + series math for the Analytics page (SPEC §10.1). No DB, no
// React — so it unit-tests in isolation (tests/unit/analytics-range.test.ts) and the
// page/aggregation layer just consumes it. All functions take `now` explicitly
// rather than reading the clock, so tests are deterministic.

export type RangeKey = "7d" | "30d" | "90d";

export interface RangePreset {
  key: RangeKey;
  label: string;
  days: number;
}

// The date-range picker's options. Day-bucketed windows including today (whose
// bucket is still filling — the chart marks it partial).
export const RANGE_PRESETS: RangePreset[] = [
  { key: "7d", label: "Last 7 days", days: 7 },
  { key: "30d", label: "Last 30 days", days: 30 },
  { key: "90d", label: "Last 90 days", days: 90 },
];

export const DEFAULT_RANGE: RangeKey = "7d";

export function parseRangeKey(value: string | null | undefined): RangeKey {
  return RANGE_PRESETS.some((r) => r.key === value)
    ? (value as RangeKey)
    : DEFAULT_RANGE;
}

export interface ResolvedRange {
  key: RangeKey;
  days: number;
  /** Inclusive 00:00 of the first day in the window. */
  start: Date;
  /** Exclusive upper bound = `now` (today's bucket is partial). */
  end: Date;
  /** Inclusive 00:00 of the last day (today) — used for axis labels. */
  lastDay: Date;
  /** Same-length window immediately before `start`, for vs-previous deltas. */
  prevStart: Date;
  prevEnd: Date;
  /** "Jun 1 – 8" / "May 9 – Jun 8". */
  label: string;
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "Jun 1 – 8" when same month, else "May 9 – Jun 8". */
export function formatRangeLabel(start: Date, lastDay: Date): string {
  const left = `${MONTHS[start.getMonth()]} ${start.getDate()}`;
  const right =
    start.getMonth() === lastDay.getMonth()
      ? `${lastDay.getDate()}`
      : `${MONTHS[lastDay.getMonth()]} ${lastDay.getDate()}`;
  return `${left} – ${right}`;
}

export function resolveRange(key: RangeKey, now: Date): ResolvedRange {
  const preset = RANGE_PRESETS.find((r) => r.key === key) ?? RANGE_PRESETS[0];
  const lastDay = startOfDay(now);
  const start = addDays(lastDay, -(preset.days - 1));
  const prevStart = addDays(start, -preset.days);
  return {
    key: preset.key,
    days: preset.days,
    start,
    end: now,
    lastDay,
    prevStart,
    prevEnd: start,
    label: formatRangeLabel(start, lastDay),
  };
}

// vs-previous delta. null when there's no prior baseline (can't divide by zero) —
// the card then shows a dash, matching the incumbent (and the "Visitors 27 / —" screenshot).
export function computeDelta(
  current: number,
  previous: number,
): { pct: number; dir: "up" | "down" | "flat" } | null {
  if (previous === 0) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  return { pct, dir: pct > 0 ? "up" : pct < 0 ? "down" : "flat" };
}

export interface DayBucket {
  /** 'YYYY-MM-DD' local key — matches the SQL date_trunc grouping. */
  key: string;
  /** "Jun 1" axis label. */
  label: string;
  date: Date;
  /** True for today's still-filling bucket (rendered hatched). */
  partial: boolean;
}

export function dayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Ordered, dense list of day buckets spanning the range (oldest → today). */
export function dayBuckets(range: ResolvedRange): DayBucket[] {
  const todayKey = dayKey(range.lastDay);
  return Array.from({ length: range.days }, (_, i) => {
    const date = addDays(range.start, i);
    return {
      key: dayKey(date),
      label: `${MONTHS[date.getMonth()]} ${date.getDate()}`,
      date,
      partial: dayKey(date) === todayKey,
    };
  });
}

/** Merge sparse `{ key, count }` DB rows onto the dense bucket list (missing = 0). */
export function fillSeries(
  buckets: DayBucket[],
  counts: Map<string, number>,
): Array<DayBucket & { count: number }> {
  return buckets.map((b) => ({ ...b, count: counts.get(b.key) ?? 0 }));
}
