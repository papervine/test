import "server-only";
import { and, eq, gte, lt, sql, desc, isNotNull } from "drizzle-orm";
import { db } from "./db";
import { analyticsEvent } from "./db/app-schema";
import {
  dayBuckets,
  fillSeries,
  computeDelta,
  type ResolvedRange,
  type DayBucket,
} from "./analytics-range";

export type AnalyticsSource = "human" | "agent";

// date_trunc groups by the Postgres session timezone; dayBuckets() keys by Node's
// local day. Dev + CI run both in the same TZ so they align — production should pin
// TZ (or pass an offset) if it ever drifts. Kept simple deliberately (SPEC §10.1).
function dayExpr() {
  return sql<string>`to_char(date_trunc('day', ${analyticsEvent.createdAt}), 'YYYY-MM-DD')`;
}

function windowWhere(
  siteId: string,
  source: AnalyticsSource,
  start: Date,
  end: Date,
) {
  return and(
    eq(analyticsEvent.siteId, siteId),
    eq(analyticsEvent.source, source),
    gte(analyticsEvent.createdAt, start),
    lt(analyticsEvent.createdAt, end),
  );
}

export interface Metrics {
  visitors: number;
  views: number;
  assistant: number;
  searches: number;
  feedback: number;
}

async function metricsForWindow(
  siteId: string,
  source: AnalyticsSource,
  start: Date,
  end: Date,
): Promise<Metrics> {
  const where = windowWhere(siteId, source, start, end);

  // One grouped scan for the per-type counts…
  const byType = await db
    .select({
      type: analyticsEvent.type,
      count: sql<number>`count(*)::int`,
    })
    .from(analyticsEvent)
    .where(where)
    .groupBy(analyticsEvent.type);

  const count = (t: string) => byType.find((r) => r.type === t)?.count ?? 0;

  // …and one for distinct visitors (distinct session over page views).
  const [{ visitors } = { visitors: 0 }] = await db
    .select({
      visitors: sql<number>`count(distinct ${analyticsEvent.sessionId})::int`,
    })
    .from(analyticsEvent)
    .where(and(where, eq(analyticsEvent.type, "page_view")));

  return {
    visitors: visitors ?? 0,
    views: count("page_view"),
    assistant: count("assistant"),
    searches: count("search"),
    feedback: count("feedback"),
  };
}

export interface MetricCard {
  key: keyof Metrics;
  label: string;
  value: number;
  delta: ReturnType<typeof computeDelta>;
}

export interface AnalyticsData {
  cards: MetricCard[];
  visitors: Array<DayBucket & { count: number }>;
  topPages: Array<{ path: string; views: number }>;
  referrals: Array<{ referrer: string; views: number }>;
}

const CARD_ORDER: Array<{ key: keyof Metrics; label: string }> = [
  { key: "visitors", label: "Visitors" },
  { key: "views", label: "Views" },
  { key: "assistant", label: "Assistant" },
  { key: "searches", label: "Searches" },
  { key: "feedback", label: "Feedback" },
];

export async function getAnalytics(
  siteId: string,
  source: AnalyticsSource,
  range: ResolvedRange,
): Promise<AnalyticsData> {
  const [current, previous, visitorRows, topPages, referrals] =
    await Promise.all([
      metricsForWindow(siteId, source, range.start, range.end),
      metricsForWindow(siteId, source, range.prevStart, range.prevEnd),
      // Distinct visitors per day for the chart.
      db
        .select({
          day: dayExpr(),
          count: sql<number>`count(distinct ${analyticsEvent.sessionId})::int`,
        })
        .from(analyticsEvent)
        .where(
          and(
            windowWhere(siteId, source, range.start, range.end),
            eq(analyticsEvent.type, "page_view"),
          ),
        )
        .groupBy(dayExpr()),
      // Top pages by views.
      db
        .select({
          path: analyticsEvent.path,
          views: sql<number>`count(*)::int`,
        })
        .from(analyticsEvent)
        .where(
          and(
            windowWhere(siteId, source, range.start, range.end),
            eq(analyticsEvent.type, "page_view"),
            isNotNull(analyticsEvent.path),
          ),
        )
        .groupBy(analyticsEvent.path)
        .orderBy(desc(sql`count(*)`))
        .limit(15),
      // Referrals by views.
      db
        .select({
          referrer: analyticsEvent.referrer,
          views: sql<number>`count(*)::int`,
        })
        .from(analyticsEvent)
        .where(
          and(
            windowWhere(siteId, source, range.start, range.end),
            eq(analyticsEvent.type, "page_view"),
            isNotNull(analyticsEvent.referrer),
          ),
        )
        .groupBy(analyticsEvent.referrer)
        .orderBy(desc(sql`count(*)`))
        .limit(15),
    ]);

  const counts = new Map(visitorRows.map((r) => [r.day, r.count]));

  return {
    cards: CARD_ORDER.map(({ key, label }) => ({
      key,
      label,
      value: current[key],
      delta: computeDelta(current[key], previous[key]),
    })),
    visitors: fillSeries(dayBuckets(range), counts),
    topPages: topPages.map((r) => ({ path: r.path ?? "/", views: r.views })),
    referrals: referrals.map((r) => ({
      referrer: r.referrer ?? "$direct",
      views: r.views,
    })),
  };
}
