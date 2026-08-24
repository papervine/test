import Link from "next/link";
import { desc, ilike, inArray, or, sql } from "drizzle-orm";
import { requirePlatformAdmin } from "@/lib/dashboard-context";
import { db } from "@/lib/db";
import { member, organization } from "@/lib/db/schema";
import { analyticsEvent, deployment, site } from "@/lib/db/app-schema";
import { siteRollups, sitesForOrgs } from "../data";
import { AdminPage, Empty, PageHead, Table, Td, Th, dateFmt } from "../ui";

// Operator › Organizations (SPEC §10.10). A scannable table with a search box, replacing the
// stack of org cards that used to make up the single admin page. Each row links to the detail
// page — members and sites live there now rather than inline, which is what made the old view
// unreadable past a handful of customers.
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function AdminOrgsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  // Called here as well as in the layout. Next renders a layout and its page concurrently,
  // so a layout-only gate still lets this page's cross-tenant queries execute before the
  // 404 wins. getSession is per-request cached, so the second check is ~free.
  await requirePlatformAdmin();
  const term = (q ?? "").trim();

  const where = term
    ? or(ilike(organization.name, `%${term}%`), ilike(organization.slug, `%${term}%`))
    : undefined;

  // Page the orgs FIRST, then roll numbers up only for that page — see data.ts for why the
  // aggregation happens in JS rather than in the select.
  const orgs = await db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      createdAt: organization.createdAt,
    })
    .from(organization)
    .where(where)
    .orderBy(desc(organization.createdAt))
    .limit(PAGE_SIZE);

  const orgIds = orgs.map((o) => o.id);
  const [memberCounts, orgSites] = await Promise.all([
    orgIds.length
      ? db
          .select({ orgId: member.organizationId, n: sql<number>`count(*)::int` })
          .from(member)
          .where(inArray(member.organizationId, orgIds))
          .groupBy(member.organizationId)
      : Promise.resolve([] as { orgId: string; n: number }[]),
    sitesForOrgs(orgIds),
  ]);
  const rollups = await siteRollups(orgSites.map((s) => s.id));

  const membersByOrg = new Map(memberCounts.map((m) => [m.orgId, m.n]));
  const perOrg = new Map(orgIds.map((id) => [id, { sites: 0, deploys: 0, events: 0 }]));
  for (const s of orgSites) {
    const agg = perOrg.get(s.orgId);
    const r = rollups.get(s.id);
    if (!agg) continue;
    agg.sites += 1;
    agg.deploys += r?.deploys ?? 0;
    agg.events += r?.events30d ?? 0;
  }

  const rows = orgs.map((o) => ({
    ...o,
    members: membersByOrg.get(o.id) ?? 0,
    ...(perOrg.get(o.id) ?? { sites: 0, deploys: 0, events: 0 }),
  }));

  return (
    <AdminPage>
      <PageHead
        title="Organizations"
        desc="Every customer organization, with members, sites, lifetime deploys and traffic over the last 30 days."
        action={
          // A plain GET form: no client state, and the search survives a reload or a shared link.
          <form className="flex items-center gap-2">
            <input
              type="search"
              name="q"
              defaultValue={term}
              placeholder="Search name or slug"
              aria-label="Search organizations"
              className="db-input h-9 w-56 rounded-lg px-3 text-sm outline-none"
            />
            <button type="submit" className="db-ring rounded-lg px-3 py-1.5 text-sm">
              Search
            </button>
          </form>
        }
      />

      <Table
        head={
          <tr>
            <Th>Organization</Th>
            <Th>Slug</Th>
            <Th right>Members</Th>
            <Th right>Sites</Th>
            <Th right>Deploys</Th>
            <Th right>Events 30d</Th>
            <Th right>Created</Th>
          </tr>
        }
      >
        {rows.length === 0 ? (
          <tr>
            <td colSpan={7}>
              <Empty>
                {term ? `No organizations match “${term}”.` : "No organizations yet."}
              </Empty>
            </td>
          </tr>
        ) : (
          rows.map((o) => (
            <tr key={o.id} className="hover:bg-[rgba(var(--ink-rgb),0.03)]">
              <Td>
                <Link href={`/admin/orgs/${o.id}`} className="font-medium hover:underline">
                  {o.name}
                </Link>
              </Td>
              <Td mono>{o.slug}</Td>
              <Td right>{o.members}</Td>
              <Td right>{o.sites}</Td>
              <Td right>{o.deploys}</Td>
              <Td right>{Number(o.events).toLocaleString()}</Td>
              <Td right>{dateFmt.format(o.createdAt)}</Td>
            </tr>
          ))
        )}
      </Table>

      {rows.length === PAGE_SIZE && (
        <p className="mt-3 text-xs text-[var(--muted)]">
          Showing the {PAGE_SIZE} newest. Narrow it with search — paging is a follow-up rather
          than a silent truncation.
        </p>
      )}
    </AdminPage>
  );
}
