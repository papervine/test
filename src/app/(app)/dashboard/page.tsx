import Link from "next/link";
import { cookies, headers } from "next/headers";
import { and, asc, desc, eq } from "drizzle-orm";
import { ExternalLink, GitBranch, PenLine } from "lucide-react";
import { getSession, listOrganizations } from "@/lib/session";
import { supportsSubdomainTenants } from "@/lib/tenant-host";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";
import { site, deployment } from "@/lib/db/app-schema";
import { ACTIVE_SITE_COOKIE, resolveActiveSite } from "@/lib/active-site";
import { partOfDay, parseFeedTarget } from "@/lib/overview";
import { ResyncButton } from "@/components/app/ResyncButton";
import { WorkflowUpsellBanner } from "@/components/app/WorkflowUpsellBanner";
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

type Search = { feed?: string };

export default async function DashboardHome({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const session = await getSession();
  const orgs = await listOrganizations();
  const activeOrg = orgs?.[0];
  // The (app) layout redirects org-less users to /onboarding, but the page renders
  // concurrently with the layout in the RSC tree — guard so it never throws first.
  if (!session || !activeOrg) return null;

  const firstName = session.user.name.split(" ")[0];
  const greeting = `Good ${partOfDay(new Date().getHours())}, ${firstName}`;

  // The Overview is per-site, scoped to the active site picked by the top-left switcher
  // (SPEC §10) — the cookie's site if it's one of this org's, else the first.
  const sites = await db
    .select()
    .from(site)
    .where(eq(site.organizationId, activeOrg.id))
    .orderBy(asc(site.createdAt));
  const cookieSlug = (await cookies()).get(ACTIVE_SITE_COOKIE)?.value;
  const activeSite = resolveActiveSite(sites, cookieSlug);

  if (!activeSite) {
    return (
      <div className="mx-auto max-w-5xl px-8 py-10">
        <h1 className="text-2xl font-semibold">{greeting}</h1>
        <div className="mt-8 rounded-xl border border-dashed border-white/[0.1] px-6 py-12 text-center">
          <p className="text-sm text-[var(--muted)]">
            No docs site yet — connect a repository to get started.
          </p>
          <ButtonLink href="/dashboard/connect" className="mt-4">
            Connect a repository
          </ButtonLink>
        </div>
      </div>
    );
  }

  // Build the site's live docs URL from the current host so it's right in dev
  // ({slug}.localhost:3100) and prod ({slug}.papervine.io), or its custom domain. On a
  // host without wildcard-subdomain support (e.g. a bare *.vercel.app), fall back to the
  // path form (/sites/{slug}) — the interim that resolves there (SPEC §2).
  const host = (await headers()).get("host") ?? "";
  const proto = host.includes("localhost") ? "http" : "https";
  const apexBase = host.replace(/^(app|www)\./, "");
  const subdomains = supportsSubdomainTenants(apexBase);
  const siteHost =
    activeSite.customDomain ??
    (subdomains
      ? `${activeSite.slug}.${apexBase}`
      : `${apexBase}/sites/${activeSite.slug}`);
  const siteUrl = activeSite.customDomain
    ? `https://${activeSite.customDomain}`
    : `${proto}://${siteHost}`;
  const repoUrl =
    activeSite.repoOwner && activeSite.repoName
      ? `https://github.com/${activeSite.repoOwner}/${activeSite.repoName}`
      : null;

  // "Last updated by" reflects the latest *live* publish, independent of which feed tab
  // is showing — the incumbent shows the live deploy here.
  const [latest] = await db
    .select({
      createdAt: deployment.createdAt,
      actorName: user.name,
      actorImage: user.image,
    })
    .from(deployment)
    .leftJoin(user, eq(deployment.actorUserId, user.id))
    .where(
      and(eq(deployment.siteId, activeSite.id), eq(deployment.target, "live")),
    )
    .orderBy(desc(deployment.createdAt))
    .limit(1);

  const feedTarget = parseFeedTarget((await searchParams).feed);
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
      actorImage: user.image,
    })
    .from(deployment)
    .leftJoin(user, eq(deployment.actorUserId, user.id))
    .where(
      and(
        eq(deployment.siteId, activeSite.id),
        eq(deployment.target, feedTarget),
      ),
    )
    .orderBy(desc(deployment.createdAt))
    .limit(20);

  const isLive = activeSite.status === "live";

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <h1 className="text-2xl font-semibold">{greeting}</h1>

      <section className="mt-8 grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Live preview — a real (scaled) iframe of the tenant's rendered home page. */}
        <a
          href={siteUrl}
          target="_blank"
          rel="noreferrer"
          className="db-ring group relative block aspect-[16/10] overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02]"
        >
          <iframe
            src={siteUrl}
            title={`${activeSite.name} preview`}
            tabIndex={-1}
            aria-hidden
            className="pointer-events-none absolute left-0 top-0 origin-top-left"
            style={{ width: "200%", height: "200%", transform: "scale(0.5)" }}
          />
          <span className="absolute inset-x-0 bottom-0 flex items-center justify-end gap-1 bg-gradient-to-t from-black/60 to-transparent px-3 py-2 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
            Open site <ExternalLink className="size-3" />
          </span>
        </a>

        {/* Status & identity. */}
        <div className="flex flex-col">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">{activeSite.name}</h2>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs ${
                isLive
                  ? "bg-emerald-500/15 text-emerald-400"
                  : "bg-white/[0.06] text-[var(--muted)]"
              }`}
            >
              <span
                className={`size-1.5 rounded-full ${isLive ? "bg-emerald-400" : "bg-[var(--muted)]"}`}
              />
              {isLive ? "Live" : "Draft"}
            </span>
          </div>

          {latest && (
            <p className="mt-2 flex items-center gap-1.5 text-sm text-[var(--muted)]">
              Last updated {timeAgo(latest.createdAt)}
              {latest.actorName && (
                <>
                  {" by "}
                  {latest.actorImage && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={latest.actorImage}
                      alt=""
                      className="size-5 rounded-full"
                    />
                  )}
                  <span className="text-[var(--fg)]">{latest.actorName}</span>
                </>
              )}
            </p>
          )}

          <div className="mt-4 flex items-center gap-2">
            <ResyncButton siteId={activeSite.id} />
            {/* Editor is a "soon" surface (SPEC §10 web-editor) — disabled for now. */}
            <button
              disabled
              className="db-ring inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--muted)] opacity-50"
            >
              <PenLine className="size-3.5" />
              Open editor
            </button>
          </div>

          <dl className="mt-6 space-y-3 text-sm">
            <div>
              <dt className="text-xs text-[var(--muted)]">Domain</dt>
              <dd className="mt-0.5">
                <a
                  href={siteUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 hover:opacity-80"
                >
                  {siteHost} <ExternalLink className="size-3 text-[var(--muted)]" />
                </a>
              </dd>
            </div>
            {repoUrl && (
              <div>
                <dt className="text-xs text-[var(--muted)]">Repository</dt>
                <dd className="mt-0.5 flex items-center gap-3">
                  <a
                    href={repoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 hover:opacity-80"
                  >
                    {activeSite.repoOwner}/{activeSite.repoName}{" "}
                    <ExternalLink className="size-3 text-[var(--muted)]" />
                  </a>
                  <span className="inline-flex items-center gap-1 text-[var(--muted)]">
                    <GitBranch className="size-3" />
                    {activeSite.branch}
                  </span>
                </dd>
              </div>
            )}
          </dl>
        </div>
      </section>

      <WorkflowUpsellBanner />

      <section className="mt-10">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-[var(--muted)]">Activity</h2>
          {/* Live / Previews toggle → deployment.target (SPEC §10.3). */}
          <div className="inline-flex rounded-lg border border-white/[0.08] p-0.5 text-xs">
            <Link
              href="/dashboard"
              scroll={false}
              className={`rounded-md px-3 py-1 ${
                feedTarget === "live"
                  ? "bg-white/[0.08] text-[var(--fg)]"
                  : "text-[var(--muted)] hover:text-[var(--fg)]"
              }`}
            >
              Live
            </Link>
            <Link
              href="/dashboard?feed=previews"
              scroll={false}
              className={`rounded-md px-3 py-1 ${
                feedTarget === "preview"
                  ? "bg-white/[0.08] text-[var(--fg)]"
                  : "text-[var(--muted)] hover:text-[var(--fg)]"
              }`}
            >
              Previews
            </Link>
          </div>
        </div>

        {feed.length === 0 ? (
          <div className="mt-3 rounded-xl border border-white/[0.06] px-6 py-8 text-center text-sm text-[var(--muted)]">
            {feedTarget === "preview"
              ? "No preview deployments yet — branch previews will appear here."
              : "No activity yet — syncs will appear here once a repo is connected."}
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-white/[0.06] rounded-xl border border-white/[0.06] bg-white/[0.02]">
            {feed.map((d) => (
              <li
                key={d.id}
                className="flex items-start justify-between gap-4 px-4 py-3"
              >
                <div className="flex min-w-0 items-start gap-3">
                  {d.actorImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={d.actorImage}
                      alt=""
                      className="mt-0.5 size-6 shrink-0 rounded-full"
                    />
                  ) : (
                    <span className="mt-0.5 size-6 shrink-0 rounded-full bg-white/[0.08]" />
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm text-[var(--fg)]">
                      {(d.commitMessage || "Sync").split("\n")[0]}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--muted)]">
                      {d.actorName ?? "Manual Update"} · {timeAgo(d.createdAt)}
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
