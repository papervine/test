import "server-only";
import { cache } from "react";
import { unstable_cache, revalidateTag } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { site } from "./db/app-schema";
import {
  SITE_ROW_TTL,
  normalizeHost,
  siteSlugTag,
  siteDomainTag,
  siteWidgetIdTag,
  reviveSiteDates,
} from "./site-cache";

export { resolveTenantSlug } from "./tenant-host";

type SiteRow = typeof site.$inferSelect;

/**
 * The site row is resolved on EVERY tenant request (subdomain → slug, custom domain → host),
 * from ~20 call sites (requestContentSource, render-tenant, the docs route, login, export,
 * reader actions). It was a Neon `select` each time — only React `cache()`'d *per-request*, so a
 * cold serverless invocation paid the full round-trip (~195 ms, the measured villain; SPEC §11.2
 * move ①). We add a cross-request Data Cache layer here (`unstable_cache`, the same mechanism
 * s3-source uses for content), in the one place every caller funnels through, so a warm tenant
 * request does zero Neon.
 *
 * Invalidation: a per-slug / per-domain tag dropped on every site mutation (`revalidateSiteRow`,
 * wired into connect/sync/auth/domain/delete). The SITE_ROW_TTL is the backstop: it self-heals a
 * missed bust, and it's the *only* invalidation for the push-webhook sync, whose `runSync` runs
 * in `after()` where `revalidateTag` doesn't propagate to the Data Cache (same constraint the
 * content cache documents in s3-source.ts). So a webhook-pushed change appears within ≤TTL;
 * manual sync and all dashboard mutations bust immediately. Pure key/tag/shape helpers live in
 * site-cache.ts (DB-free, unit-tested).
 */
export const getSiteBySlug = cache(async (slug: string): Promise<SiteRow | null> => {
  // Single-repo mode (`papervine dev` / the smoke fixtures) serves ONE repo from PAPERVINE_CONTENT
  // with no control-plane DB — there are no tenant rows to resolve, so short-circuit before touching
  // the DB (which isn't there and would ECONNREFUSED). Callers already treat null as "no tenant".
  if (process.env.PAPERVINE_CONTENT) return null;
  // unstable_cache is created per-call with the slug in BOTH keyParts and the tag, so the cache
  // entry is per-slug and the tag busts exactly it. The outer React cache() keeps per-request dedupe.
  const read = unstable_cache(
    async () => (await db.select().from(site).where(eq(site.slug, slug)).limit(1))[0] ?? null,
    ["site-by-slug", slug],
    { tags: [siteSlugTag(slug)], revalidate: SITE_ROW_TTL },
  );
  return reviveSiteDates(await read());
});

// Resolve a site by its vanity domain (the host the owner pointed at us, e.g. docs.example.com).
export const getSiteByCustomDomain = cache(async (host: string): Promise<SiteRow | null> => {
  // Single-repo mode (PAPERVINE_CONTENT) has no custom-domain tenants and no DB — no-op before the
  // query so the apex/preview home renders DB-free instead of 500ing on ECONNREFUSED (smoke gate).
  if (process.env.PAPERVINE_CONTENT) return null;
  const name = normalizeHost(host);
  const read = unstable_cache(
    async () =>
      (await db.select().from(site).where(eq(site.customDomain, name)).limit(1))[0] ?? null,
    ["site-by-domain", name],
    { tags: [siteDomainTag(name)], revalidate: SITE_ROW_TTL },
  );
  return reviveSiteDates(await read());
});

/**
 * Resolve a site by its public embeddable-widget id (SPEC §8.7) — the only identifier a
 * third-party page embedding the widget carries, since its Host header is the CUSTOMER's
 * domain, not ours. Unlike getSiteBySlug/getSiteByCustomDomain (whose connection-error
 * handling lives in the getSiteByHost wrapper), this has no such wrapper — the widget chat
 * route calls it directly — so it catches DB errors itself and returns null, the same
 * no-op-without-a-DB contract the smoke gate requires of every rendered-path lookup.
 */
export const getSiteByWidgetId = cache(async (widgetId: string): Promise<SiteRow | null> => {
  if (process.env.PAPERVINE_CONTENT) return null;
  try {
    const read = unstable_cache(
      async () =>
        (await db.select().from(site).where(eq(site.widgetId, widgetId)).limit(1))[0] ?? null,
      ["site-by-widget-id", widgetId],
      { tags: [siteWidgetIdTag(widgetId)], revalidate: SITE_ROW_TTL },
    );
    return reviveSiteDates(await read());
  } catch {
    return null;
  }
});

/**
 * Drop a site's cached slug/domain/widget lookups after any mutation to its row (connect,
 * sync, auth/domain/git/widget settings, delete). Pass the slug always, plus every custom
 * domain whose mapping changed — INCLUDING the old domain when it's changed or removed, so a
 * deactivated domain stops resolving immediately rather than lingering for the TTL — and the
 * widgetId whenever a mutation changes fields the widget chat route reads (enabled flag,
 * allowed origins). A no-op inside `after()` (the push webhook), where the TTL backstop
 * covers it instead (see the note above).
 */
export function revalidateSiteRow(opts: {
  slug: string;
  domains?: (string | null | undefined)[];
  widgetId?: string | null;
}): void {
  // Next 16 requires a cacheLife profile as the second argument; "max" preserves the
  // pre-16 single-argument behavior (immediate, unconditional invalidation) exactly —
  // Next's own deprecation warning for the old call shape names "max" as the replacement.
  revalidateTag(siteSlugTag(opts.slug), "max");
  for (const d of opts.domains ?? []) {
    if (d) revalidateTag(siteDomainTag(d), "max");
  }
  if (opts.widgetId) revalidateTag(siteWidgetIdTag(opts.widgetId), "max");
}

/**
 * Resolve the site a request is for from its Host header — a tenant subdomain
 * ({slug}.papervine.io / {slug}.localhost) or a connected custom domain
 * (docs.example.com). Returns null on the apex/preview host (PAPERVINE_CONTENT
 * single-repo mode) and for an unknown host, so callers (the /mcp + llms surfaces,
 * analytics instrumentation) safely no-op when there's no tenant.
 */
export async function getSiteByHost(host: string | null) {
  if (!host) return null;
  try {
    const { resolveTenantSlug } = await import("./tenant-host");
    const slug = resolveTenantSlug(host);
    if (slug) return await getSiteBySlug(slug);
    return await getSiteByCustomDomain(host);
  } catch {
    // No reachable DB (e.g. the DB-free smoke job / a transient outage) → behave
    // like "no tenant": callers no-op (logging off, default content source) rather
    // than rejecting the request. Honors this function's documented no-op contract.
    return null;
  }
}
