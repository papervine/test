import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { requirePlatformAdmin } from "@/lib/dashboard-context";
import { db } from "@/lib/db";
import { organization } from "@/lib/db/schema";
import { deployment, site } from "@/lib/db/app-schema";
import { timeAgo, triggerLabel } from "@/lib/overview";
import { AdminPage, Empty, PageHead, Table, Td, Th } from "../ui";

// Operator › Deploys (SPEC §10.10). A cross-tenant activity feed: the newest deployments with
// which site and customer they belong to. This is the "is the platform healthy right now" view —
// a run of failures across different tenants means something of ours broke, which was invisible
// when deploy counts were just a number on a per-org card.
export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

export default async function AdminDeploysPage() {
  // Called here as well as in the layout. Next renders a layout and its page concurrently,
  // so a layout-only gate still lets this page's cross-tenant queries execute before the
  // 404 wins. getSession is per-request cached, so the second check is ~free.
  await requirePlatformAdmin();
  const rows = await db
    .select({
      id: deployment.id,
      status: deployment.status,
      trigger: deployment.trigger,
      commitSha: deployment.commitSha,
      error: deployment.error,
      createdAt: deployment.createdAt,
      siteName: site.name,
      siteSlug: site.slug,
      orgId: organization.id,
      orgName: organization.name,
    })
    .from(deployment)
    .innerJoin(site, eq(deployment.siteId, site.id))
    .innerJoin(organization, eq(site.organizationId, organization.id))
    .orderBy(desc(deployment.createdAt))
    .limit(PAGE_SIZE);

  return (
    <AdminPage>
      <PageHead
        title="Deploys"
        desc="The newest deployments across every tenant. A cluster of failures spanning customers usually means something of ours broke, not theirs."
      />

      <Table
        head={
          <tr>
            <Th>Site</Th>
            <Th>Organization</Th>
            <Th>Status</Th>
            <Th>Trigger</Th>
            <Th>Commit</Th>
            <Th right>When</Th>
          </tr>
        }
      >
        {rows.length === 0 ? (
          <tr>
            <td colSpan={6}>
              <Empty>Nothing has deployed yet.</Empty>
            </td>
          </tr>
        ) : (
          rows.map((d) => (
            <tr key={d.id} className="hover:bg-[rgba(var(--ink-rgb),0.03)]">
              <Td>
                <span className="font-medium">{d.siteName}</span>{" "}
                <span className="font-mono text-xs text-[var(--muted)]">{d.siteSlug}</span>
              </Td>
              <Td>
                <Link href={`/admin/orgs/${d.orgId}`} className="hover:underline">
                  {d.orgName}
                </Link>
              </Td>
              <Td>
                <span className={d.status === "failed" ? "text-red-400" : ""}>{d.status}</span>
                {/* The error is the whole reason to look at this table — surface it inline
                    rather than making someone open each tenant's Activity feed. */}
                {d.error && (
                  <span className="ml-2 text-xs text-[var(--muted)]">{d.error.slice(0, 80)}</span>
                )}
              </Td>
              <Td>{triggerLabel(d.trigger, null)}</Td>
              <Td mono>
                {d.commitSha ? (
                  d.commitSha.slice(0, 7)
                ) : (
                  <span className="text-[var(--muted)]">—</span>
                )}
              </Td>
              <Td right>{timeAgo(d.createdAt.getTime())}</Td>
            </tr>
          ))
        )}
      </Table>

      {rows.length === PAGE_SIZE && (
        <p className="mt-3 text-xs text-[var(--muted)]">
          Showing the {PAGE_SIZE} most recent.
        </p>
      )}
    </AdminPage>
  );
}
