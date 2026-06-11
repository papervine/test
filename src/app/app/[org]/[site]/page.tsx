import Link from "next/link";
import { headers } from "next/headers";
import { and, desc, eq } from "drizzle-orm";
import { ExternalLink, GitBranch, Globe, Lock, PenLine } from "lucide-react";
import { supportsSubdomainTenants } from "@/lib/tenant-host";
import { AUTH_METHOD_META, isAuthMethod } from "@/lib/reader-auth";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";
import { deployment } from "@/lib/db/app-schema";
import { requireSite } from "@/lib/dashboard-context";
import { siteBase } from "@/lib/dashboard-nav";
import { parseFeedTarget } from "@/lib/overview";
import { Greeting } from "@/components/app/Greeting";
import { ResyncButton } from "@/components/app/ResyncButton";
import { SitePreview } from "@/components/app/SitePreview";

// The Re-sync button's server action (resyncSite) re-pulls the whole repo inline; give it
// headroom past the platform default so a large repo doesn't time out mid-sync.
export const maxDuration = 60;

function timeAgo(date: Date): string {
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

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
  const { session, site: activeSite } = await requireSite(orgSlug, siteSlug);
  const firstName = session.user.name.split(" ")[0];
  const base = siteBase(orgSlug, siteSlug);

  // Build the site's live docs URL from the current host so it's right in dev
  // ({slug}.localhost:3100) and prod ({slug}.papervine.io), or its custom domain. On a
  // host without wildcard-subdomain support (e.g. a bare *.vercel.app), fall back to the
  // path form (/sites/{slug}) — the interim that resolves there (SPEC §2).
  const host = (await headers()).get("host") ?? "";
  const proto = host.includes("localhost") ? "http" : "https";
  const apexBase = host.replace(/^(app|www)\./, "");
  const subdomains = supportsSubdomainTenants(apexBase);
  const siteHostUrl =
    activeSite.customDomain ??
    (subdomains
      ? `${activeSite.slug}.${apexBase}`
      : `${apexBase}/sites/${activeSite.slug}`);
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
      <h1 className="text-2xl font-semibold">
        <Greeting firstName={firstName} />
      </h1>

      <section className="mt-8 grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Live preview — a real (scaled) iframe of the tenant's home page, with a
            viewer-side load-time badge (SitePreview owns the timing, needs the client). */}
        <SitePreview siteUrl={siteUrl} name={activeSite.name} />

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
          <div className="inline-flex rounded-lg border border-white/[0.08] p-0.5 text-xs">
            <Link
              href={base}
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
              href={`${base}?feed=previews`}
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
