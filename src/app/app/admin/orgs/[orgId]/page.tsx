import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { requirePlatformAdmin } from "@/lib/dashboard-context";
import { db } from "@/lib/db";
import { member, organization, user } from "@/lib/db/schema";
import { site } from "@/lib/db/app-schema";
import { timeAgo } from "@/lib/overview";
import { siteRollups } from "../../data";
import { ImpersonateButton } from "../../ImpersonateButton";
import { AdminPage, Empty, PageHead, StatusPill, Table, Td, Th, dateFmt } from "../../ui";

// Operator › Organizations › one org (SPEC §10.10). Everything the old single page inlined for
// EVERY org — members with their impersonate buttons, sites with deploy counts and traffic — for
// the one you asked about. Queries are scoped to this org rather than the whole table.
//
// The layout already gated on the allowlist; requirePlatformAdmin runs here too because the
// member list needs the current user id (you can't impersonate yourself).
export const dynamic = "force-dynamic";

export default async function AdminOrgDetailPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const session = await requirePlatformAdmin();

  const [org] = await db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      createdAt: organization.createdAt,
    })
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1);
  // 404 rather than an empty shell: an unknown id is a bad link, not a real org with no data.
  if (!org) notFound();

  const [members, sites] = await Promise.all([
    db
      .select({
        userId: member.userId,
        role: member.role,
        email: user.email,
        name: user.name,
        joinedAt: member.createdAt,
      })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(eq(member.organizationId, orgId)),
    db
      .select({
        id: site.id,
        name: site.name,
        slug: site.slug,
        status: site.status,
        repoOwner: site.repoOwner,
        repoName: site.repoName,
        customDomain: site.customDomain,
        createdAt: site.createdAt,
      })
      .from(site)
      .where(eq(site.organizationId, orgId))
      .orderBy(desc(site.createdAt)),
  ]);

  // Rollups for this org's sites — see data.ts for why they aren't in the select above.
  const rollups = await siteRollups(sites.map((s) => s.id));

  return (
    <AdminPage>
      <Link
        href="/admin/orgs"
        className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Organizations
      </Link>

      <div className="mt-4">
        <PageHead
          title={org.name}
          desc={`${org.slug} · created ${dateFmt.format(org.createdAt)}`}
        />
      </div>

      <h2 className="mb-3 text-sm font-medium">
        Members <span className="text-[var(--muted)]">{members.length}</span>
      </h2>
      <Table
        head={
          <tr>
            <Th>Email</Th>
            <Th>Name</Th>
            <Th>Role</Th>
            <Th right>Joined</Th>
            <Th right />
          </tr>
        }
      >
        {members.length === 0 ? (
          <tr>
            <td colSpan={5}>
              <Empty>No members.</Empty>
            </td>
          </tr>
        ) : (
          members.map((m) => (
            <tr key={m.userId} className="hover:bg-[rgba(var(--ink-rgb),0.03)]">
              <Td>{m.email}</Td>
              <Td>{m.name || <span className="text-[var(--muted)]">—</span>}</Td>
              <Td>{m.role}</Td>
              <Td right>{m.joinedAt ? dateFmt.format(m.joinedAt) : "—"}</Td>
              <Td right>
                {/* Never offer to impersonate yourself — it's a no-op that reads as a bug. */}
                {m.userId !== session.user.id && <ImpersonateButton userId={m.userId} />}
              </Td>
            </tr>
          ))
        )}
      </Table>

      <h2 className="mb-3 mt-8 text-sm font-medium">
        Sites <span className="text-[var(--muted)]">{sites.length}</span>
      </h2>
      <Table
        head={
          <tr>
            <Th>Site</Th>
            <Th>Status</Th>
            <Th>Source</Th>
            <Th>Domain</Th>
            <Th right>Deploys</Th>
            <Th right>Events 30d</Th>
            <Th right>Last deploy</Th>
          </tr>
        }
      >
        {sites.length === 0 ? (
          <tr>
            <td colSpan={7}>
              <Empty>This organization has no sites yet.</Empty>
            </td>
          </tr>
        ) : (
          sites.map((s) => (
            <tr key={s.id} className="hover:bg-[rgba(var(--ink-rgb),0.03)]">
              <Td>
                <span className="font-medium">{s.name}</span>{" "}
                <span className="font-mono text-xs text-[var(--muted)]">{s.slug}</span>
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
              <Td right>{rollups.get(s.id)?.deploys ?? 0}</Td>
              <Td right>{(rollups.get(s.id)?.events30d ?? 0).toLocaleString()}</Td>
              <Td right>
                {rollups.get(s.id)?.lastDeployAt ? (
                  timeAgo(rollups.get(s.id)!.lastDeployAt!.getTime())
                ) : (
                  <span className="text-[var(--muted)]">never</span>
                )}
              </Td>
            </tr>
          ))
        )}
      </Table>
    </AdminPage>
  );
}
