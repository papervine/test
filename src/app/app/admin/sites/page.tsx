import Link from "next/link";
import { desc, eq, ilike, or } from "drizzle-orm";
import { requirePlatformAdmin } from "@/lib/dashboard-context";
import { db } from "@/lib/db";
import { organization } from "@/lib/db/schema";
import { site } from "@/lib/db/app-schema";
import { timeAgo } from "@/lib/overview";
import { siteRollups } from "../data";
import { AdminPage, Empty, PageHead, StatusPill, Table, Td, Th } from "../ui";

// Operator › Sites (SPEC §10.10). Every site across every tenant in one table — the view the old
// console couldn't give you at all, because sites were nested inside per-org cards. Answers
// "which sites are stuck in draft", "who's on a custom domain", "what's actually getting traffic".
export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

export default async function AdminSitesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  // Called here as well as in the layout. Next renders a layout and its page concurrently, so a
  // layout-only gate still lets this page's cross-tenant queries execute before the 404 wins.
  // getSession is per-request cached, so the second check is ~free.
  await requirePlatformAdmin();
  const term = (q ?? "").trim();

  const where = term
    ? or(
        ilike(site.name, `%${term}%`),
        ilike(site.slug, `%${term}%`),
        ilike(organization.name, `%${term}%`),
      )
    : undefined;

  const rows = await db
    .select({
      id: site.id,
      name: site.name,
      slug: site.slug,
      status: site.status,
      repoOwner: site.repoOwner,
      repoName: site.repoName,
      customDomain: site.customDomain,
      orgId: organization.id,
      orgName: organization.name,
    })
    .from(site)
    .innerJoin(organization, eq(site.organizationId, organization.id))
    .where(where)
    .orderBy(desc(site.createdAt))
    .limit(PAGE_SIZE);

  // Rollups for THIS page's sites only — see data.ts for why they aren't in the select.
  const rollups = await siteRollups(rows.map((r) => r.id));

  return (
    <AdminPage>
      <PageHead
        title="Sites"
        desc="Every site on this deployment, newest first — with its source, domain, deploy count and traffic over the last 30 days."
        action={
          <form className="flex items-center gap-2">
            <input
              type="search"
              name="q"
              defaultValue={term}
              placeholder="Search site or org"
              aria-label="Search sites"
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
            <Th>Site</Th>
            <Th>Organization</Th>
            <Th>Status</Th>
            <Th>Source</Th>
            <Th>Domain</Th>
            <Th right>Deploys</Th>
            <Th right>Events 30d</Th>
            <Th right>Last deploy</Th>
          </tr>
        }
      >
        {rows.length === 0 ? (
          <tr>
            <td colSpan={8}>
              <Empty>{term ? `No sites match “${term}”.` : "No sites yet."}</Empty>
            </td>
          </tr>
        ) : (
          rows.map((s) => {
            const roll = rollups.get(s.id);
            return (
              <tr key={s.id} className="hover:bg-[rgba(var(--ink-rgb),0.03)]">
                <Td>
                  <span className="font-medium">{s.name}</span>{" "}
                  <span className="font-mono text-xs text-[var(--muted)]">{s.slug}</span>
                </Td>
                <Td>
                  <Link href={`/admin/orgs/${s.orgId}`} className="hover:underline">
                    {s.orgName}
                  </Link>
                </Td>
                <Td>
                  <StatusPill status={s.status} />
                </Td>
                <Td mono>
                  {s.repoOwner && s.repoName ? (
                    `${s.repoOwner}/${s.repoName}`
                  ) : (
                    // No repo isn't "broken" — a Papervine-hosted site has none by design.
                    <span className="text-[var(--muted)]">Papervine</span>
                  )}
                </Td>
                <Td mono>{s.customDomain || <span className="text-[var(--muted)]">—</span>}</Td>
                <Td right>{roll?.deploys ?? 0}</Td>
                <Td right>{(roll?.events30d ?? 0).toLocaleString()}</Td>
                <Td right>
                  {roll?.lastDeployAt ? (
                    timeAgo(roll.lastDeployAt.getTime())
                  ) : (
                    <span className="text-[var(--muted)]">never</span>
                  )}
                </Td>
              </tr>
            );
          })
        )}
      </Table>

      {rows.length === PAGE_SIZE && (
        <p className="mt-3 text-xs text-[var(--muted)]">
          Showing the {PAGE_SIZE} newest — narrow it with search rather than assuming this is all
          of them.
        </p>
      )}
    </AdminPage>
  );
}
