import Link from "next/link";
import { headers } from "next/headers";
import { desc, eq } from "drizzle-orm";
import { getSession, listOrganizations } from "@/lib/session";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";
import { site, deployment } from "@/lib/db/app-schema";
import { ResyncButton } from "@/components/app/ResyncButton";
import { ButtonLink } from "@/components/platform/Button";

function timeAgo(date: Date): string {
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default async function DashboardHome() {
  const session = await getSession();
  const orgs = await listOrganizations();
  const activeOrg = orgs?.[0];
  // The (app) layout redirects org-less users to /onboarding, but the page renders
  // concurrently with the layout in the RSC tree — guard so it never throws first.
  if (!session || !activeOrg) return null;

  const sites = await db
    .select()
    .from(site)
    .where(eq(site.organizationId, activeOrg.id));

  // Build each site's live docs URL from the current host so it's right in dev
  // ({slug}.localhost:3100) and prod ({slug}.docbot.app), or its custom domain.
  const host = (await headers()).get("host") ?? "";
  const proto = host.includes("localhost") ? "http" : "https";
  const apexBase = host.replace(/^(app|www)\./, "");
  const siteHost = (s: (typeof sites)[number]) =>
    s.customDomain ?? `${s.slug}.${apexBase}`;
  const siteUrl = (s: (typeof sites)[number]) =>
    s.customDomain
      ? `https://${s.customDomain}`
      : `${proto}://${s.slug}.${apexBase}`;

  const feed = await db
    .select({
      id: deployment.id,
      status: deployment.status,
      commitMessage: deployment.commitMessage,
      error: deployment.error,
      filesAdded: deployment.filesAdded,
      filesEdited: deployment.filesEdited,
      createdAt: deployment.createdAt,
      actorName: user.name,
      siteName: site.name,
    })
    .from(deployment)
    .innerJoin(site, eq(deployment.siteId, site.id))
    .leftJoin(user, eq(deployment.actorUserId, user.id))
    .where(eq(site.organizationId, activeOrg.id))
    .orderBy(desc(deployment.createdAt))
    .limit(20);

  const hour = new Date().getHours();
  const partOfDay = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const firstName = session.user.name.split(" ")[0];

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <h1 className="text-2xl font-semibold">
        Good {partOfDay}, {firstName}
      </h1>

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-[var(--muted)]">
            Your sites
          </h2>
          {sites.length > 0 && (
            <ButtonLink href="/dashboard/connect" size="sm">
              Connect repo
            </ButtonLink>
          )}
        </div>
        {sites.length === 0 ? (
          <div className="mt-3 rounded-xl border border-dashed border-white/[0.1] px-6 py-10 text-center">
            <p className="text-sm text-[var(--muted)]">No docs sites yet.</p>
            <ButtonLink href="/dashboard/connect" className="mt-4">
              Connect a repository
            </ButtonLink>
          </div>
        ) : (
          <ul className="mt-3 grid gap-3">
            {sites.map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3"
              >
                <a
                  href={siteUrl(s)}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 flex-1 hover:opacity-80"
                >
                  <p className="text-sm font-medium">{s.name}</p>
                  <p className="truncate text-xs text-[var(--muted)]">
                    {s.repoOwner}/{s.repoName} ·{" "}
                    <span className="text-[var(--fg)]/70">{siteHost(s)} ↗</span>
                  </p>
                </a>
                <ResyncButton siteId={s.id} />
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                    s.status === "live"
                      ? "bg-emerald-500/15 text-emerald-400"
                      : "bg-white/[0.06] text-[var(--muted)]"
                  }`}
                >
                  {s.status === "live" ? "Live" : "Draft"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-medium text-[var(--muted)]">Activity</h2>
        {feed.length === 0 ? (
          <div className="mt-3 rounded-xl border border-white/[0.06] px-6 py-8 text-center text-sm text-[var(--muted)]">
            No activity yet — syncs will appear here once a repo is connected.
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-white/[0.06] rounded-xl border border-white/[0.06] bg-white/[0.02]">
            {feed.map((d) => (
              <li
                key={d.id}
                className="flex items-start justify-between gap-4 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-[var(--fg)]">
                    {(d.commitMessage || "Sync").split("\n")[0]}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">
                    {d.actorName ?? "Unknown"} · {d.siteName} ·{" "}
                    {timeAgo(d.createdAt)}
                    {(d.filesAdded > 0 || d.filesEdited > 0) &&
                      ` · ${d.filesAdded} added, ${d.filesEdited} edited`}
                  </p>
                  {d.status === "failed" && d.error && (
                    <details className="mt-1.5 max-w-full">
                      <summary className="cursor-pointer select-none text-xs text-red-400/80 hover:text-red-400">
                        Why it failed
                      </summary>
                      <pre className="mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 p-3 text-xs leading-relaxed text-[var(--muted)]">
                        {d.error}
                      </pre>
                    </details>
                  )}
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                    d.status === "successful"
                      ? "bg-emerald-500/15 text-emerald-400"
                      : d.status === "failed"
                        ? "bg-red-500/15 text-red-400"
                        : "bg-white/[0.06] text-[var(--muted)]"
                  }`}
                >
                  {d.status === "successful"
                    ? "Successful"
                    : d.status === "failed"
                      ? "Failed"
                      : "Building"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
