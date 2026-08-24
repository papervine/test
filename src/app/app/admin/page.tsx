import Link from "next/link";
import { desc, gte, sql } from "drizzle-orm";
import { Building2, Globe, Rocket, Users } from "lucide-react";
import { requirePlatformAdmin } from "@/lib/dashboard-context";
import { db } from "@/lib/db";
import { organization, user } from "@/lib/db/schema";
import { analyticsEvent, deployment, site } from "@/lib/db/app-schema";
import { timeAgo } from "@/lib/overview";
import { AdminPage, Empty, PageHead, StatCard, StatusPill, Table, Td, Th, dateFmt } from "./ui";

// Operator › Overview (SPEC §10.10). Counts and the most recent activity — the "is anything
// happening" view. The per-org and per-site detail moved to their own sections, which is the
// point: this page used to be the counts PLUS an unbounded stack of every org with its members
// and sites inlined, and every query fetched every row to build it.
//
// Read-only by design: support/ops needs eyes, not write access (mutations stay on the
// tenant-scoped surfaces where their guards live). The allowlist gate is on the layout.
export const dynamic = "force-dynamic";

const RECENT = 8;

export default async function AdminOverviewPage() {
  // Called here as well as in the layout. Next renders a layout and its page concurrently,
  // so a layout-only gate still lets this page's cross-tenant queries execute before the
  // 404 wins. getSession is per-request cached, so the second check is ~free.
  await requirePlatformAdmin();
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Counts are aggregates, and the lists are LIMITed — nothing here grows with the customer
  // base the way the old single page did.
  const [
    [{ orgs }],
    [{ users }],
    [{ sites }],
    [{ deploys }],
    [{ events }],
    recentOrgs,
    recentSites,
    recentDeploys,
  ] = await Promise.all([
    db.select({ orgs: sql<number>`count(*)::int` }).from(organization),
    db.select({ users: sql<number>`count(*)::int` }).from(user),
    db.select({ sites: sql<number>`count(*)::int` }).from(site),
    db.select({ deploys: sql<number>`count(*)::int` }).from(deployment),
    db
      .select({ events: sql<number>`count(*)::int` })
      .from(analyticsEvent)
      .where(gte(analyticsEvent.createdAt, since30d)),
    db
      .select({ id: organization.id, name: organization.name, slug: organization.slug, createdAt: organization.createdAt })
      .from(organization)
      .orderBy(desc(organization.createdAt))
      .limit(RECENT),
    db
      .select({
        id: site.id,
        name: site.name,
        slug: site.slug,
        status: site.status,
        createdAt: site.createdAt,
        orgId: site.organizationId,
      })
      .from(site)
      .orderBy(desc(site.createdAt))
      .limit(RECENT),
    db
      .select({
        id: deployment.id,
        siteId: deployment.siteId,
        status: deployment.status,
        createdAt: deployment.createdAt,
      })
      .from(deployment)
      .orderBy(desc(deployment.createdAt))
      .limit(RECENT),
  ]);

  // One extra lookup to name the sites the recent deploys belong to — bounded by RECENT.
  const siteNames = new Map(recentSites.map((s) => [s.id, s.name]));
  const missing = recentDeploys.map((d) => d.siteId).filter((id) => !siteNames.has(id));
  if (missing.length) {
    const rows = await db
      .select({ id: site.id, name: site.name })
      .from(site)
      .where(sql`${site.id} = any(${missing})`);
    for (const r of rows) siteNames.set(r.id, r.name);
  }

  return (
    <AdminPage>
      <PageHead
        title="Overview"
        desc="Every customer organization on this deployment. Read-only — the operator console reports, it doesn't mutate."
      />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Customers" value={orgs} icon={Building2} href="/admin/orgs" />
        <StatCard label="Users" value={users} icon={Users} />
        <StatCard label="Sites" value={sites} icon={Globe} href="/admin/sites" />
        <StatCard label="Deploys" value={deploys} icon={Rocket} href="/admin/deploys" />
      </section>
      <p className="mt-2 text-xs text-[var(--muted)]">
        {events.toLocaleString()} analytics events across all sites in the last 30 days.
      </p>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-sm font-medium">Newest organizations</h2>
          <Table
            head={
              <tr>
                <Th>Organization</Th>
                <Th>Slug</Th>
                <Th right>Created</Th>
              </tr>
            }
          >
            {recentOrgs.length === 0 ? (
              <tr>
                <td colSpan={3}>
                  <Empty>No organizations yet.</Empty>
                </td>
              </tr>
            ) : (
              recentOrgs.map((o) => (
                <tr key={o.id} className="hover:bg-[rgba(var(--ink-rgb),0.03)]">
                  <Td>
                    <Link href={`/admin/orgs/${o.id}`} className="hover:underline">
                      {o.name}
                    </Link>
                  </Td>
                  <Td mono>{o.slug}</Td>
                  <Td right>{dateFmt.format(o.createdAt)}</Td>
                </tr>
              ))
            )}
          </Table>
        </div>

        <div>
          <h2 className="mb-3 text-sm font-medium">Newest sites</h2>
          <Table
            head={
              <tr>
                <Th>Site</Th>
                <Th>Status</Th>
                <Th right>Created</Th>
              </tr>
            }
          >
            {recentSites.length === 0 ? (
              <tr>
                <td colSpan={3}>
                  <Empty>No sites yet.</Empty>
                </td>
              </tr>
            ) : (
              recentSites.map((s) => (
                <tr key={s.id} className="hover:bg-[rgba(var(--ink-rgb),0.03)]">
                  <Td>
                    <Link href={`/admin/orgs/${s.orgId}`} className="hover:underline">
                      {s.name}
                    </Link>
                  </Td>
                  <Td>
                    <StatusPill status={s.status} />
                  </Td>
                  <Td right>{dateFmt.format(s.createdAt)}</Td>
                </tr>
              ))
            )}
          </Table>
        </div>

        <div className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-medium">Recent deploys</h2>
          <Table
            head={
              <tr>
                <Th>Site</Th>
                <Th>Status</Th>
                <Th right>When</Th>
              </tr>
            }
          >
            {recentDeploys.length === 0 ? (
              <tr>
                <td colSpan={3}>
                  <Empty>Nothing has deployed yet.</Empty>
                </td>
              </tr>
            ) : (
              recentDeploys.map((d) => (
                <tr key={d.id} className="hover:bg-[rgba(var(--ink-rgb),0.03)]">
                  <Td>{siteNames.get(d.siteId) ?? <span className="text-[var(--muted)]">—</span>}</Td>
                  <Td>{d.status}</Td>
                  <Td right>{timeAgo(d.createdAt.getTime())}</Td>
                </tr>
              ))
            )}
          </Table>
        </div>
      </div>
    </AdminPage>
  );
}
