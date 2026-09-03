import { isAppHost, isPlatformHost, resolveTenantSlug } from "./tenant-host";
import { MARKETING_ORIGIN } from "./marketing-seo";
import { PRICES_CHECKED } from "./marketing-alternatives";

/**
 * `robots.txt` and `sitemap.xml` for the PLATFORM's own hosts (SPEC §2) — pure decisions,
 * so `app/robots.ts` and `app/sitemap.ts` stay two-line adapters and this can be unit-tested
 * without a server (`tests/unit/seo-routes.test.ts`).
 *
 * HOST-AWARENESS IS THE WHOLE POINT, and it's why this couldn't be a static file in `public/`.
 * One Next app answers on four kinds of host: the marketing apex, the app host, tenant docs
 * subdomains, and tenants' own custom domains. A root `robots.txt` that always described the
 * marketing site would publish OUR sitemap on `customer.com/robots.txt` — and a `sitemap.xml`
 * would hand a customer's crawler a list of our marketing URLs on their domain. So each host
 * class gets its own answer, and the two that aren't ours get told nothing about us.
 *
 * The fourth case is the one that isn't a host at all: **single-repo mode**. With
 * `PAPERVINE_CONTENT` set (`npx papervine dev`, `papervine serve`, the smoke gate) the apex IS
 * somebody else's docs site, served from their directory — so it must not advertise our
 * sitemap either. Same class of leak as the Sentry DSN that got compiled into the public CLI
 * tarball (§10.6): the packaging boundary is about dependencies, and this one arrives by
 * *serving*.
 *
 * Tenant hosts get their OWN sitemap, not ours: the pages are enumerated by the renderer
 * (`packages/renderer/lib/sitemap.ts`, the same walk `/llms.txt` uses, so gated and `noindex`
 * pages are already excluded) and `robots.txt` on that host points at it. What must never
 * happen is the other thing — advertising the MARKETING sitemap on a customer's domain, or
 * listing our pages inside theirs — and that is still what the host check below prevents.
 */

export interface RobotsPolicy {
  /** false → `Disallow: /` for every agent. */
  allow: boolean;
  /** Absolute sitemap URL to advertise, when there is one that describes THIS host. */
  sitemap?: string;
}

export interface HostContext {
  /** The request's `Host` header, verbatim (port included). */
  host: string | null;
  /** True when PAPERVINE_CONTENT is set — the app is serving one repo, not the platform. */
  singleRepo: boolean;
}

/**
 * Is this request for our marketing site? True for the apex with or without `www` and for
 * local/IP hosts in dev; false for the app host, tenant subdomains and custom domains.
 * (`www` is a reserved label in `resolveTenantSlug`, so `www.papervine.io` is not a tenant.)
 */
export function isMarketingHost(ctx: HostContext): boolean {
  if (ctx.singleRepo) return false;
  const { host } = ctx;
  if (isDocsLabelHost(host)) return false;
  return (
    isPlatformHost(host) && !isAppHost(host) && resolveTenantSlug(host) === null
  );
}

/**
 * `docs.{platform}` — reserved from slug resolution (nothing of ours serves it) yet claimable
 * as a CUSTOM DOMAIN, which is exactly what the dogfood site does with `docs.papervine.io`.
 * That combination made it look like the marketing apex to a host-only check: not the app
 * host, and no tenant slug. Harmless while the middleware rewrote its whole path space, and
 * not harmless the moment the crawler files started answering for themselves — it served the
 * MARKETING sitemap on the docs host and pointed robots.txt at the marketing sitemap.
 *
 * The authoritative answer is the site row (`docsSite` below), which a pure function can't
 * read. This is the second layer: whatever the database says, `docs.{platform}` is not our
 * marketing site, so a DB outage degrades to "no sitemap" rather than to the wrong one.
 */
export function isDocsLabelHost(host: string | null): boolean {
  return Boolean(host) && isPlatformHost(host) && /^docs\./i.test(host as string);
}

export function robotsPolicyFor(ctx: HostContext & { docsSite?: boolean }): RobotsPolicy {
  // A resolved site row beats every host heuristic: it is how a customer's own domain is
  // recognised, and how `docs.{platform}` is recognised as the docs site rather than the apex.
  if (ctx.docsSite) {
    const origin = docsOriginFor(ctx.host);
    return origin ? { allow: true, sitemap: `${origin}/sitemap.xml` } : { allow: true };
  }

  // The control plane is an authenticated app. There is nothing on it worth indexing, and
  // its `/login` and `/signup` are the only pages a crawler can even reach — thin duplicates
  // of pages the marketing apex already ranks for.
  if (!ctx.singleRepo && isAppHost(ctx.host)) return { allow: false };

  if (isMarketingHost(ctx)) {
    // The canonical origin, never the request's own host — for the same reason
    // `marketingMetadata` hardcodes the canonical: a preview deployment must point crawlers
    // at the real apex rather than at itself.
    return { allow: true, sitemap: `${MARKETING_ORIGIN}/sitemap.xml` };
  }

  // A tenant's docs site, a custom domain, or a repo being served by the CLI. Crawling is
  // fine, and the sitemap to point at is the one THIS host serves — built from their pages,
  // on their origin. Relative would be legal in robots.txt but is widely mishandled, so the
  // origin is taken from the request: unlike the marketing case there is no canonical host to
  // hardcode, and a custom domain must advertise itself rather than the subdomain behind it.
  const origin = docsOriginFor(ctx.host);
  return origin ? { allow: true, sitemap: `${origin}/sitemap.xml` } : { allow: true };
}

/**
 * The absolute origin a docs site is being served on, from the request Host. `https` unless
 * the host is plainly local — a dev server on `localhost:3000` or `{slug}.localhost` would
 * otherwise advertise an `https` sitemap it cannot serve.
 */
export function docsOriginFor(host: string | null): string | null {
  if (!host) return null;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) || /\.localhost(:\d+)?$/.test(host);
  return `${local ? "http" : "https"}://${host}`;
}

export interface SitemapEntry {
  url: string;
  lastModified?: string;
  changeFrequency?: "daily" | "weekly" | "monthly" | "yearly";
  priority?: number;
}

/**
 * The marketing pages, in the order we'd want them read.
 *
 * `lastModified` is set ONLY where there's a real date to give: the comparison page carries
 * the date its prices were checked, which is the one thing on it that goes stale. Everything
 * else omits it rather than stamping `new Date()` per request — a sitemap where every URL
 * claims to have changed this second is a sitemap whose `lastmod` gets ignored, and rightly.
 */
export const MARKETING_ROUTES: Array<{
  path: string;
  priority: number;
  changeFrequency: SitemapEntry["changeFrequency"];
  lastModified?: string;
}> = [
  { path: "/", priority: 1, changeFrequency: "weekly" },
  { path: "/pricing", priority: 0.9, changeFrequency: "monthly" },
  {
    path: "/docs-platform-alternatives",
    priority: 0.9,
    changeFrequency: "monthly",
    lastModified: PRICES_CHECKED,
  },
  { path: "/privacy", priority: 0.3, changeFrequency: "yearly" },
  { path: "/terms", priority: 0.3, changeFrequency: "yearly" },
  { path: "/refund", priority: 0.3, changeFrequency: "yearly" },
];

/** The sitemap for a host — the marketing routes on our apex, nothing anywhere else. */
export function sitemapFor(ctx: HostContext): SitemapEntry[] {
  if (!isMarketingHost(ctx)) return [];
  return MARKETING_ROUTES.map((r) => ({
    url: `${MARKETING_ORIGIN}${r.path === "/" ? "" : r.path}`,
    ...(r.lastModified ? { lastModified: r.lastModified } : {}),
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));
}
