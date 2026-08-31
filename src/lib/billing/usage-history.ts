import "server-only";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { usageEvent } from "../db/app-schema";
import { dayBuckets, type ResolvedRange } from "../analytics-range";
import { buildUsageSeries, type UsageChartData } from "../usage-series";

// Credit consumption over time, grouped by day × feature for the Usage chart
// (SPEC §10 Billing). Org-scoped: credits belong to the organization, not a site — the
// same reason the Usage surface reads `requireSite(...).org`. All shaping is in the pure
// usage-series module; this is only the aggregate.
//
// Same day-bucketing caveat as analytics.ts: date_trunc groups by the Postgres session
// timezone while dayBuckets() keys by Node's local day. Dev and CI share a TZ, so they
// line up; a production TZ drift would shift a bar by a day, never lose one.
export async function getUsageHistory(
  organizationId: string,
  range: ResolvedRange,
): Promise<UsageChartData> {
  const rows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${usageEvent.createdAt}), 'YYYY-MM-DD')`,
      feature: usageEvent.feature,
      credits: sql<number>`sum(${usageEvent.credits})::int`,
    })
    .from(usageEvent)
    .where(
      and(
        eq(usageEvent.organizationId, organizationId),
        gte(usageEvent.createdAt, range.start),
        lt(usageEvent.createdAt, range.end),
      ),
    )
    .groupBy(
      sql`date_trunc('day', ${usageEvent.createdAt})`,
      usageEvent.feature,
    );

  return buildUsageSeries(dayBuckets(range), rows);
}
