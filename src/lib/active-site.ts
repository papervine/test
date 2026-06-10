// The "active site" an org member is currently working in — the top-left switcher
// (SPEC §10) selects it, and per-site dashboard pages (Analytics, Editor…) scope to it.
// Persisted as a cookie holding the site slug; resolution is a pure function so it's
// unit-testable and shared by the layout (switcher) and the per-site pages.

export const ACTIVE_SITE_COOKIE = "pv_site";

/**
 * The site the dashboard should treat as active: the cookie's slug if it's one the user
 * actually has (guards a stale/foreign cookie), else the first site, else null. Order of
 * `sites` is the caller's choice (we sort by createdAt, so "first" = oldest).
 */
export function resolveActiveSite<T extends { slug: string }>(
  sites: readonly T[],
  cookieSlug: string | null | undefined,
): T | null {
  return sites.find((s) => s.slug === cookieSlug) ?? sites[0] ?? null;
}
