import { gte, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { analyticsEvent, deployment, site } from "@/lib/db/app-schema";

// Per-site rollups for the Operator console.
//
// Two earlier attempts failed, and the reason is worth recording. Joining four GROUPED subqueries
// broke because each aliased its count `"n"`, so drizzle rendered every reference as a bare
// `coalesce("n", 0)` — ambiguous, query rejected. Rewriting them as correlated scalar subqueries
// broke differently: drizzle renders the columns inside a `sql` template UNQUALIFIED, producing
// `(select count(*) from "member" where "organization_id" = "id")`, which Postgres can't resolve
// either.
//
// So: aggregate in SQL, join in JS, and keep it bounded by passing only the ids on the current
// page. That's the property that matters — the old console's problem was reading every row in
// every table to render one screen, not the joining.
export type SiteRollup = { deploys: number; lastDeployAt: Date | null; events30d: number };

export async function siteRollups(siteIds: string[]): Promise<Map<string, SiteRollup>> {
  const out = new Map<string, SiteRollup>();
  if (siteIds.length === 0) return out;

  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [deployRows, eventRows] = await Promise.all([
    db
      .select({
        siteId: deployment.siteId,
        deploys: sql<number>`count(*)::int`,
        lastAt: sql<Date | null>`max(${deployment.createdAt})`,
      })
      .from(deployment)
      .where(inArray(deployment.siteId, siteIds))
      .groupBy(deployment.siteId),
    db
      .select({ siteId: analyticsEvent.siteId, events: sql<number>`count(*)::int` })
      .from(analyticsEvent)
      .where(sql`${inArray(analyticsEvent.siteId, siteIds)} and ${gte(analyticsEvent.createdAt, since30d)}`)
      .groupBy(analyticsEvent.siteId),
  ]);

  for (const id of siteIds) out.set(id, { deploys: 0, lastDeployAt: null, events30d: 0 });
  for (const d of deployRows) {
    const row = out.get(d.siteId);
    if (row) {
      row.deploys = d.deploys;
      row.lastDeployAt = d.lastAt ? new Date(d.lastAt) : null;
    }
  }
  for (const e of eventRows) {
    const row = out.get(e.siteId);
    if (row) row.events30d = e.events;
  }
  return out;
}

/** Sites belonging to the given orgs, for rolling per-site numbers up to the org. */
export async function sitesForOrgs(orgIds: string[]) {
  if (orgIds.length === 0) return [];
  return db
    .select({ id: site.id, orgId: site.organizationId })
    .from(site)
    .where(inArray(site.organizationId, orgIds));
}
