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

export interface AssistantMetrics {
  total: number; // questions in the last 30 days
  answered: number; // status='answered' in the last 30 days
  notAnswered: number; // status IN ('unanswered','deflected') in the last 30 days
  totalDelta: ReturnType<typeof computeDelta>; // vs the prior 30 days ("vs last month")
  answeredDelta: ReturnType<typeof computeDelta>;
}

/**
 * Assistant usage counts for the Assistant page cards, split by outcome `status` over a rolling
 * 30-day window, compared to the prior 30 days ("vs last month"). A rolling window (vs calendar
 * month) avoids the number cratering on the 1st of the month. `status` is written by the
 * assistant route on stream finish/error (answered vs unanswered); a NULL status (in-flight /
 * legacy row) counts toward the total but neither bucket. `now` is injected so it's testable.
 */
export async function assistantMetrics(siteId: string, now = new Date()): Promise<AssistantMetrics> {
  const DAY = 86_400_000;
  const monthStart = new Date(now.getTime() - 30 * DAY);
  const lastMonthStart = new Date(now.getTime() - 60 * DAY);

  const countByStatus = async (start: Date, end: Date) => {
    const rows = await db
      .select({ status: analyticsEvent.status, count: sql<number>`count(*)::int` })
      .from(analyticsEvent)
      .where(
        and(
          eq(analyticsEvent.siteId, siteId),
          eq(analyticsEvent.type, "assistant"),
          gte(analyticsEvent.createdAt, start),
          lt(analyticsEvent.createdAt, end),
        ),
      )
      .groupBy(analyticsEvent.status);
    const total = rows.reduce((s, r) => s + r.count, 0);
    const of = (...statuses: string[]) =>
      rows.filter((r) => r.status && statuses.includes(r.status)).reduce((s, r) => s + r.count, 0);
    return { total, answered: of("answered"), notAnswered: of("unanswered", "deflected") };
  };

  const cur = await countByStatus(monthStart, now);
  const prev = await countByStatus(lastMonthStart, monthStart);
  return {
    total: cur.total,
    answered: cur.answered,
    notAnswered: cur.notAnswered,
    totalDelta: computeDelta(cur.total, prev.total),
    answeredDelta: computeDelta(cur.answered, prev.answered),
  };
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

// ── Agents tab (SPEC §10.1) ────────────────────────────────────────────────────
// The Agents toggle is a distinct view, not the human dashboard re-filtered: AI
// clients hit different surfaces (the /mcp server, the llms.txt index, raw pages),
// so the metrics that matter are different. Two cards — Agent Visitors and MCP
// Searches (agent-source `search` events come only from /mcp's search_docs, so an
// agent search IS an MCP search) — plus Top pages and a Top *agents* breakdown
// (Claude/ChatGPT/…), keyed off the `agent` column.

export interface AgentAnalyticsData {
  agentVisitors: MetricCard;
  mcpSearches: MetricCard;
  visitors: Array<DayBucket & { count: number }>;
  topPages: Array<{ path: string; views: number }>;
  topAgents: Array<{ agent: string; visits: number }>;
}

// One distinct-visitor (agent page_view sessions) + MCP-search count for a window —
// mirrors metricsForWindow() but scoped to the two agent metrics, so deltas reuse
// the same prev-window machinery.
async function agentMetricsForWindow(
  siteId: string,
  start: Date,
  end: Date,
): Promise<{ agentVisitors: number; mcpSearches: number }> {
  const where = windowWhere(siteId, "agent", start, end);
  const [[{ agentVisitors } = { agentVisitors: 0 }], [{ mcpSearches } = { mcpSearches: 0 }]] =
    await Promise.all([
      db
        .select({
          agentVisitors: sql<number>`count(distinct ${analyticsEvent.sessionId})::int`,
        })
        .from(analyticsEvent)
        .where(and(where, eq(analyticsEvent.type, "page_view"))),
      db
        .select({ mcpSearches: sql<number>`count(*)::int` })
        .from(analyticsEvent)
        .where(and(where, eq(analyticsEvent.type, "search"))),
    ]);
  return { agentVisitors: agentVisitors ?? 0, mcpSearches: mcpSearches ?? 0 };
}

export async function getAgentAnalytics(
  siteId: string,
  range: ResolvedRange,
): Promise<AgentAnalyticsData> {
  const [current, previous, visitorRows, topPages, topAgents] = await Promise.all([
    agentMetricsForWindow(siteId, range.start, range.end),
    agentMetricsForWindow(siteId, range.prevStart, range.prevEnd),
    // Distinct agent visitors per day for the chart.
    db
      .select({
        day: dayExpr(),
        count: sql<number>`count(distinct ${analyticsEvent.sessionId})::int`,
      })
      .from(analyticsEvent)
      .where(
        and(
          windowWhere(siteId, "agent", range.start, range.end),
          eq(analyticsEvent.type, "page_view"),
        ),
      )
      .groupBy(dayExpr()),
    // Top pages by agent views.
    db
      .select({ path: analyticsEvent.path, views: sql<number>`count(*)::int` })
      .from(analyticsEvent)
      .where(
        and(
          windowWhere(siteId, "agent", range.start, range.end),
          eq(analyticsEvent.type, "page_view"),
          isNotNull(analyticsEvent.path),
        ),
      )
      .groupBy(analyticsEvent.path)
      .orderBy(desc(sql`count(*)`))
      .limit(15),
    // Top agents by distinct visits (sessions), across all agent event types.
    db
      .select({
        agent: analyticsEvent.agent,
        visits: sql<number>`count(distinct ${analyticsEvent.sessionId})::int`,
      })
      .from(analyticsEvent)
      .where(
        and(
          windowWhere(siteId, "agent", range.start, range.end),
          isNotNull(analyticsEvent.agent),
        ),
      )
      .groupBy(analyticsEvent.agent)
      .orderBy(desc(sql`count(distinct ${analyticsEvent.sessionId})`))
      .limit(15),
  ]);

  const counts = new Map(visitorRows.map((r) => [r.day, r.count]));

  return {
    agentVisitors: {
      key: "visitors",
      label: "Agent Visitors",
      value: current.agentVisitors,
      delta: computeDelta(current.agentVisitors, previous.agentVisitors),
    },
    mcpSearches: {
      key: "searches",
      label: "MCP Searches",
      value: current.mcpSearches,
      delta: computeDelta(current.mcpSearches, previous.mcpSearches),
    },
    visitors: fillSeries(dayBuckets(range), counts),
    topPages: topPages.map((r) => ({ path: r.path ?? "/", views: r.views })),
    topAgents: topAgents.map((r) => ({ agent: r.agent ?? "Other", visits: r.visits })),
  };
}
