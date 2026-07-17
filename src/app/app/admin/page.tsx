import Link from "next/link";
import { desc, eq, gte, sql } from "drizzle-orm";
import { ArrowLeft, Building2, Globe, Rocket, Users } from "lucide-react";
import { requirePlatformAdmin } from "@/lib/dashboard-context";
import { db } from "@/lib/db";
import { member, organization, user } from "@/lib/db/schema";
import { analyticsEvent, deployment, site } from "@/lib/db/app-schema";
import { timeAgo } from "@/lib/overview";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { ImpersonateButton } from "./ImpersonateButton";

// Platform superadmin (SPEC §10.10) — the operator's cross-tenant overview: every
// customer org with its members, sites, deploy counts and recent traffic. Read-only by
// design: support/ops needs eyes, not write access (mutations stay on the tenant-scoped
// surfaces where their guards live). Gated by requirePlatformAdmin — the PLATFORM_ADMIN_EMAILS
// allowlist — which 404s everyone else; the middleware's edge gate already bounced the
// signed-out. Lives outside the [org] layout: this page is cross-org, so the org-scoped
// rail doesn't apply.

export const dynamic = "force-dynamic";

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function StatusPill({ status }: { status: string }) {
  const live = status === "live";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs ${
        live ? "text-emerald-400" : "text-[var(--muted)]"
      }`}
    >
      <span
        className={`size-1.5 rounded-full ${live ? "bg-emerald-400" : "bg-[var(--muted)]"}`}
      />
      {status}
    </span>
  );
}

export default async function PlatformAdminPage() {
  const session = await requirePlatformAdmin();
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [orgs, memberRows, siteRows, deployAgg, eventAgg, [{ users: userCount }]] =
    await Promise.all([
      db
        .select({
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          createdAt: organization.createdAt,
        })
        .from(organization)
        .orderBy(desc(organization.createdAt)),
      db
        .select({
          orgId: member.organizationId,
          userId: member.userId,
          role: member.role,
          email: user.email,
          name: user.name,
        })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id)),
      db
        .select({
          id: site.id,
          organizationId: site.organizationId,
          name: site.name,
          slug: site.slug,
          status: site.status,
          repoOwner: site.repoOwner,
          repoName: site.repoName,
          customDomain: site.customDomain,
          createdAt: site.createdAt,
        })
        .from(site),
      db
        .select({
          siteId: deployment.siteId,
          deploys: sql<number>`count(*)::int`,
          lastAt: sql<string | null>`max(${deployment.createdAt})`,
        })
        .from(deployment)
        .groupBy(deployment.siteId),
      db
        .select({
          siteId: analyticsEvent.siteId,
          events: sql<number>`count(*)::int`,
        })
        .from(analyticsEvent)
        .where(gte(analyticsEvent.createdAt, since30d))
        .groupBy(analyticsEvent.siteId),
      db.select({ users: sql<number>`count(*)::int` }).from(user),
    ]);

  const membersByOrg = new Map<string, typeof memberRows>();
  for (const m of memberRows) {
    const list = membersByOrg.get(m.orgId) ?? [];
    list.push(m);
    membersByOrg.set(m.orgId, list);
  }
  const sitesByOrg = new Map<string, typeof siteRows>();
  for (const s of siteRows) {
    const list = sitesByOrg.get(s.organizationId) ?? [];
    list.push(s);
    sitesByOrg.set(s.organizationId, list);
  }
  const deploysBySite = new Map(deployAgg.map((d) => [d.siteId, d]));
  const eventsBySite = new Map(eventAgg.map((e) => [e.siteId, e.events]));
  const totalDeploys = deployAgg.reduce((s, d) => s + d.deploys, 0);
  const totalEvents30d = eventAgg.reduce((s, e) => s + e.events, 0);

  const stats = [
    { label: "Customers", value: orgs.length, icon: Building2 },
    { label: "Users", value: userCount, icon: Users },
    { label: "Sites", value: siteRows.length, icon: Globe },
    { label: "Deploys", value: totalDeploys, icon: Rocket },
  ];

  return (
    <PlatformShell variant="lite">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Dashboard
        </Link>

        <div className="mt-4 flex items-center justify-between gap-4">
          <h1 className="text-xl font-semibold">Platform admin</h1>
          <Link
            href="/admin/billing"
            className="db-ring rounded-lg px-3 py-1.5 text-sm font-medium text-[var(--fg)]"
          >
            Billing console
          </Link>
        </div>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Every customer organization on this deployment — members, sites, deploys, and
          traffic over the last 30 days. Read-only.
        </p>

        <section className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
          {stats.map(({ label, value, icon: Icon }) => (
            <div
              key={label}
              className="rounded-xl border border-[rgba(var(--ink-rgb),0.08)] px-4 py-3"
            >
              <div className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
                <Icon className="h-3.5 w-3.5" />
                {label}
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
            </div>
          ))}
        </section>
        <p className="mt-2 text-xs text-[var(--muted)]">
          {totalEvents30d} analytics events across all sites in the last 30 days.
        </p>

        {orgs.length === 0 && (
          <p className="mt-10 text-sm text-[var(--muted)]">No organizations yet.</p>
        )}

        <div className="mt-8 flex flex-col gap-6">
          {orgs.map((org) => {
            const members = membersByOrg.get(org.id) ?? [];
            const sites = sitesByOrg.get(org.id) ?? [];
            return (
              <section
                key={org.id}
                className="rounded-xl border border-[rgba(var(--ink-rgb),0.08)] p-5"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h2 className="text-base font-semibold">{org.name}</h2>
                  <span className="font-mono text-xs text-[var(--muted)]">
                    {org.slug}
                  </span>
                  <span className="ml-auto text-xs text-[var(--muted)]">
                    created {dateFmt.format(org.createdAt)}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {members.map((m) => (
                    <span
                      key={`${m.orgId}:${m.email}`}
                      className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(var(--ink-rgb),0.08)] px-2.5 py-0.5 text-xs"
                    >
                      {m.email}
                      <span className="text-[var(--muted)]">{m.role}</span>
                      {m.userId !== session.user.id && (
                        <ImpersonateButton userId={m.userId} />
                      )}
                    </span>
                  ))}
                  {members.length === 0 && (
                    <span className="text-xs text-[var(--muted)]">No members</span>
                  )}
                </div>

                {sites.length > 0 ? (
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="text-xs text-[var(--muted)]">
                          <th className="py-1.5 pr-4 font-medium">Site</th>
                          <th className="py-1.5 pr-4 font-medium">Status</th>
                          <th className="py-1.5 pr-4 font-medium">Repo</th>
                          <th className="py-1.5 pr-4 font-medium">Domain</th>
                          <th className="py-1.5 pr-4 font-medium">Deploys</th>
                          <th className="py-1.5 pr-4 font-medium">Last deploy</th>
                          <th className="py-1.5 font-medium">Events (30d)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sites.map((s) => {
                          const d = deploysBySite.get(s.id);
                          return (
                            <tr
                              key={s.id}
                              className="border-t border-[rgba(var(--ink-rgb),0.06)]"
                            >
                              <td className="py-2 pr-4">
                                <Link
                                  href={`/${org.slug}/${s.slug}`}
                                  className="text-[var(--fg)] hover:text-[var(--blue)]"
                                >
                                  {s.name}
                                </Link>
                                <span className="ml-2 font-mono text-xs text-[var(--muted)]">
                                  {s.slug}
                                </span>
                              </td>
                              <td className="py-2 pr-4">
                                <StatusPill status={s.status} />
                              </td>
                              <td className="py-2 pr-4 font-mono text-xs text-[var(--muted)]">
                                {s.repoOwner ? `${s.repoOwner}/${s.repoName}` : "—"}
                              </td>
                              <td className="py-2 pr-4 font-mono text-xs text-[var(--muted)]">
                                {s.customDomain ?? "—"}
                              </td>
                              <td className="py-2 pr-4 tabular-nums">
                                {d?.deploys ?? 0}
                              </td>
                              <td className="py-2 pr-4 text-xs text-[var(--muted)]">
                                {d?.lastAt ? timeAgo(new Date(d.lastAt).getTime()) : "—"}
                              </td>
                              <td className="py-2 tabular-nums">
                                {eventsBySite.get(s.id) ?? 0}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="mt-4 text-xs text-[var(--muted)]">No sites yet.</p>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </PlatformShell>
  );
}
