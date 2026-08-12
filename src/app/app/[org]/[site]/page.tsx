import Link from "next/link";
import { headers } from "next/headers";
import { and, desc, eq } from "drizzle-orm";
import { ExternalLink, GitBranch, Globe, Lock, PenLine } from "lucide-react";
import { supportsSubdomainTenants, tenantHostFor } from "@/lib/tenant-host";
import { AUTH_METHOD_META, isAuthMethod } from "@/lib/reader-auth";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";
import { deployment } from "@/lib/db/app-schema";
import { requireSite } from "@/lib/dashboard-context";
import { canSeeFeature } from "@/lib/features";
import { siteBase } from "@/lib/dashboard-nav";
import { getActivityFeed } from "@/lib/activity-feed";
import { feedParam, parseFeedTarget, timeAgo } from "@/lib/overview";
import { ActivityFeed } from "@/components/app/ActivityFeed";
import { BuildingPreview } from "@/components/app/BuildingPreview";
import { Greeting } from "@/components/app/Greeting";
import { ResyncButton } from "@/components/app/ResyncButton";
import { SitePreview } from "@/components/app/SitePreview";

// The Re-sync button's server action (resyncSite) re-pulls the whole repo inline; give it
// real headroom — 60s sat right AT a big repo's sync time (intermittent 504s); 300 is the
// Fluid Compute cap on Hobby (Pro allows 800).
export const maxDuration = 300;

type Params = { org: string; site: string };
type Search = { feed?: string };

// The per-site Overview (SPEC §10.3), scoped to the site in the URL (/:org/:site).
export default async function SiteOverview({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<Search>;
}) {
  const { org: orgSlug, site: siteSlug } = await params;
  const { session, role, site: activeSite } = await requireSite(orgSlug, siteSlug);
  const firstName = session.user.name.split(" ")[0];
  const base = siteBase(orgSlug, siteSlug);

  // The site's live docs URL. The tenant host is CONFIGURED (tenantHostFor), not derived
  // from this request — the dashboard runs on app.{platform}, so deriving would produce the
  // legacy `{slug}.{platform}` host. Dev stays on {slug}.localhost:3100 with the port. On a
  // host without wildcard-subdomain support (e.g. a bare *.vercel.app), fall back to the
  // path form (/sites/{slug}) — the interim that resolves there (SPEC §2).
  const host = (await headers()).get("host") ?? "";
  const proto = host.includes("localhost") ? "http" : "https";
  const apexBase = host.replace(/^(app|www)\./, "");
  const tenantHost = tenantHostFor(activeSite.slug, host);
  const subdomains = supportsSubdomainTenants(tenantHost.replace(/^[^.]+\./, ""));
  const siteHostUrl =
    activeSite.customDomain ??
    (subdomains ? tenantHost : `${apexBase}/sites/${activeSite.slug}`);
  const siteUrl = activeSite.customDomain
    ? `https://${activeSite.customDomain}`
    : `${proto}://${siteHostUrl}`;
  const repoUrl =
    activeSite.repoOwner && activeSite.repoName
      ? `https://github.com/${activeSite.repoOwner}/${activeSite.repoName}`
      : null;

  // Reader-auth status surfaced on the overview (SPEC §11.2): when a site gates its docs,
  // show that plus the chosen method, with a jump to the settings surface that edits it.
  const authMethodLabel = isAuthMethod(activeSite.authMethod)
    ? AUTH_METHOD_META[activeSite.authMethod].label
    : null;

  // "Last updated by" reflects the latest *live* publish, independent of which feed tab
  // is showing — hosted docs platforms shows the live deploy here.
  const [latest] = await db
    .select({
      createdAt: deployment.createdAt,
      status: deployment.status,
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
  const feed = await getActivityFeed(activeSite.id, feedTarget);

  const isLive = activeSite.status === "live";
  // First sync still in flight (connect runs it in the background): show the "assembling"
  // animation instead of an iframe to a site that has no rendered content yet. A site that's
  // already live keeps its real preview even during a re-sync (its current docs still render).
  const isBuilding = !isLive && latest?.status === "building";

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-10">
      <h1 className="text-2xl font-semibold">
        <Greeting firstName={firstName} />
      </h1>

      <section className="mt-8 grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Live preview — a real (scaled) iframe of the tenant's home page, with a
            viewer-side load-time badge (SitePreview owns the timing, needs the client). While
            the first sync runs, swap in the animated "building" state (it self-refreshes to the
            real preview once the site goes live). */}
        {isBuilding ? (
          <BuildingPreview name={activeSite.name} siteId={activeSite.id} />
        ) : (
          <SitePreview siteUrl={siteUrl} name={activeSite.name} />
        )}

        {/* Status & identity. */}
        <div className="flex flex-col">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">{activeSite.name}</h2>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs ${
                isLive
                  ? "bg-emerald-500/15 text-emerald-400"
                  : "bg-[rgba(var(--ink-rgb),0.06)] text-[var(--muted)]"
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
              Last updated {timeAgo(latest.createdAt.getTime())}
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
            {/* The web editor (SPEC §9.2/§10), gated by the editor feature like the rail item. */}
            {canSeeFeature("editor.workspace", role) ? (
              <Link
                href={`${base}/editor`}
                className="db-ring inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--fg)] hover:bg-[var(--surface-2)]"
              >
                <PenLine className="size-3.5" />
                Open editor
              </Link>
            ) : (
              <button
                disabled
                className="db-ring inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--muted)] opacity-50"
              >
                <PenLine className="size-3.5" />
                Open editor
              </button>
            )}
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
                  {siteHostUrl} <ExternalLink className="size-3 text-[var(--muted)]" />
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
            <div>
              <dt className="text-xs text-[var(--muted)]">Authentication</dt>
              <dd className="mt-0.5 flex items-center gap-3">
                {activeSite.authEnabled ? (
                  <span className="inline-flex items-center gap-1.5 text-emerald-400">
                    <Lock className="size-3" />
                    Required
                    {authMethodLabel && (
                      <span className="text-[var(--muted)]">
                        · {authMethodLabel}
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-[var(--muted)]">
                    <Globe className="size-3" />
                    Public — anyone can read
                  </span>
                )}
                <Link
                  href={`${base}/settings/authentication`}
                  className="text-[var(--muted)] hover:opacity-80"
                >
                  Edit
                </Link>
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="mt-10">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-[var(--muted)]">Activity</h2>
          {/* Live / Previews toggle → deployment.target (SPEC §10.3). */}
          <div className="inline-flex rounded-lg border border-[rgba(var(--ink-rgb),0.08)] p-0.5 text-xs">
            <Link
              href={base}
              scroll={false}
              className={`rounded-md px-3 py-1 ${
                feedTarget === "live"
                  ? "bg-[rgba(var(--ink-rgb),0.08)] text-[var(--fg)]"
                  : "text-[var(--muted)] hover:text-[var(--fg)]"
              }`}
            >
              Live
            </Link>
            <Link
              href={`${base}?feed=previews`}
              scroll={false}
              className={`rounded-md px-3 py-1 ${
                feedTarget === "preview"
                  ? "bg-[rgba(var(--ink-rgb),0.08)] text-[var(--fg)]"
                  : "text-[var(--muted)] hover:text-[var(--fg)]"
              }`}
            >
              Previews
            </Link>
          </div>
        </div>

        {/* Live, self-polling (SPEC §10.3): seeded with these server-rendered rows, then it
            polls /:org/:site/activity so a webhook sync that lands while you're here shows
            up — and resolves building → successful — without a reload. */}
        <ActivityFeed
          endpoint={`${base}/activity?feed=${feedParam(feedTarget)}`}
          target={feedTarget}
          initialRows={feed}
          repoUrl={repoUrl}
          siteId={activeSite.id}
        />
      </section>
    </div>
  );
}
