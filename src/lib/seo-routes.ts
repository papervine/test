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
 * Tenant hosts are deliberately NOT given a sitemap here. Generating one from a tenant's
 * `docs.json` is a real feature (their pages, their `lastmod`, their gated pages excluded) and
 * belongs with the renderer, not bolted onto the marketing sitemap. Today they reach neither
 * route — the middleware rewrites their whole path space — and the neutral branches below are
 * belt-and-braces for the day one of them does.
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
  return (
    isPlatformHost(host) && !isAppHost(host) && resolveTenantSlug(host) === null
  );
}

export function robotsPolicyFor(ctx: HostContext): RobotsPolicy {
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
  // fine and none of our business; advertising our sitemap on their domain is not.
  return { allow: true };
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
