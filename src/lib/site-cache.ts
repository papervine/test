import type { site } from "./db/app-schema";

// Pure helpers for the site-row read-through cache (src/lib/tenant.ts). Kept DB-free and
// without "server-only" so they're unit-testable (SPEC §11.2 move ①). The cache wiring
// (unstable_cache / revalidateTag) lives in tenant.ts; the *keys, tags, and shape-fixups* live
// here so the cache definition and the invalidation can't drift apart on the tag string.

type SiteRow = typeof site.$inferSelect;

// Backstop TTL (seconds): the per-request Neon read is replaced by a cross-request Data Cache
// entry dropped explicitly on every mutation (revalidateSiteRow). The TTL only bites if a bust
// is missed, or for the push-webhook sync, whose runSync runs in after() where revalidateTag
// doesn't propagate — there fresh content appears within the TTL. 60s keeps that window tight
// while still serving the vast majority of requests from cache.
export const SITE_ROW_TTL = 60;

// Strip the port and lowercase, so docs.Example.com:443 and docs.example.com share one entry.
export function normalizeHost(host: string): string {
  return host.split(":")[0].toLowerCase();
}

// Per-slug / per-domain cache tags. Used by BOTH the unstable_cache definition and
// revalidateSiteRow, so a bust always targets the exact entry the read registered.
export const siteSlugTag = (slug: string) => `site-row:slug:${slug}`;
export const siteDomainTag = (host: string) => `site-row:domain:${normalizeHost(host)}`;

/**
 * Re-hydrate the `site` table's three `timestamp` columns after a Data Cache round-trip.
 * Drizzle hands back `Date` objects, but the Data Cache serializes through JSON, so a cached
 * row's timestamps come back as ISO strings. Callers that rely on `instanceof Date` — notably
 * requestContentSource, which folds `updatedAt.getTime()` into the content-cache version key —
 * would silently break (a string there changes the key and serves stale content). `new Date(x)`
 * is a no-op clone when `x` is already a `Date` (the uncached read) and parses the ISO string
 * when cached. Null `customDomainVerifiedAt` stays null.
 */
export function reviveSiteDates(row: SiteRow | null): SiteRow | null {
  if (!row) return row;
  return {
    ...row,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    customDomainVerifiedAt: row.customDomainVerifiedAt
      ? new Date(row.customDomainVerifiedAt)
      : null,
  };
}
