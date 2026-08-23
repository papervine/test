// Pure URL helpers for the URL-scoped control plane (SPEC §10). The dashboard is served
// on the `app.` host at bare /:org/:site — but in this single Next app the route files
// live under an invisible internal mount (/app/:org/:site), reached via the app-host
// middleware rewrite (the same trick tenant docs use: acme.papervine.io/x → /sites/acme/x).
// So there are two path spaces, and mixing them is a bug:
//   • PUBLIC (bare)   — what the user sees: links, router.push, redirect() targets.
//   • INTERNAL (/app) — the real route path: revalidatePath only, never shown to a user.
// Kept pure (no "use client"/server-only) so it's unit-testable and shared client + server.
import { canSeeFeature } from "./features";

// The invisible internal mount the app-host middleware rewrites bare paths onto. Nothing
// user-facing should ever contain it.
export const APP_MOUNT = "/app";

/** PUBLIC base path for a site: /:org/:site (bare — for links / redirects). */
export function siteBase(orgSlug: string, siteSlug: string): string {
  return `/${orgSlug}/${siteSlug}`;
}

/** PUBLIC path under a site, e.g. siteHref(org, site, "analytics"). */
export function siteHref(orgSlug: string, siteSlug: string, sub = ""): string {
  const base = siteBase(orgSlug, siteSlug);
  return sub ? `${base}/${sub}` : base;
}

/** PUBLIC "add a site" start-method chooser for an org: /:org/connect (SPEC §10.11). */
export function connectHref(orgSlug: string): string {
  return `/${orgSlug}/connect`;
}

/**
 * Where a freshly-created site drops you. A Papervine-hosted site is seeded and live the
 * moment it exists, so the next thing to do is WRITE — send its creator to Studio. Anyone
 * who can't see Studio (it's gated to owners/admins) would hit a `notFound()` there, so they
 * get the Overview instead. Following the feature gate rather than hardcoding a role means
 * flipping `editor.workspace` to "everyone" needs no change here.
 */
export function postCreateHref(
  orgSlug: string,
  siteSlug: string,
  role: string | null | undefined,
): string {
  return canSeeFeature("editor.workspace", role)
    ? siteHref(orgSlug, siteSlug, "editor")
    : siteBase(orgSlug, siteSlug);
}

/**
 * INTERNAL route path (under /app) for revalidatePath — Next's cache is keyed by the real
 * route, not the rewritten-away public URL. Never put this in a link or redirect.
 */
export function siteRoute(orgSlug: string, siteSlug: string, sub = ""): string {
  return `${APP_MOUNT}${siteHref(orgSlug, siteSlug, sub)}`;
}

/**
 * Parse the active org + site out of a PUBLIC (bare) dashboard pathname. The rail and the
 * settings subnav read usePathname — the visible URL — so they always see bare paths
 * (/:org/:site/…). On the org-level …/connect page seg[1] is "connect" (no real site),
 * which pickCurrentSite falls back from.
 */
export function parseSitePath(pathname: string): {
  orgSlug?: string;
  siteSlug?: string;
} {
  const seg = pathname.split("/").filter(Boolean); // [org, site?, ...]
  return { orgSlug: seg[0], siteSlug: seg[1] };
}

/**
 * The site the rail/switcher should treat as current: the one whose slug is in the path,
 * else the first site, else null. Driven by the URL — `pathSiteSlug` is `connect` (or
 * undefined) on the org-level pages, which falls back to the first site.
 */
export function pickCurrentSite<T extends { slug: string }>(
  sites: readonly T[],
  pathSiteSlug: string | null | undefined,
): T | null {
  return sites.find((s) => s.slug === pathSiteSlug) ?? sites[0] ?? null;
}

/**
 * Where the switcher sends you when you pick `newSiteSlug`, preserving the sub-page
 * you're on (switch sites while on Analytics → land on the new site's Analytics), the
 * way hosted docs platforms' switcher does. From an org-level page (no site in the path, e.g.
 * …/connect) it lands on the new site's home. Returns a PUBLIC bare path.
 */
export function switchSiteHref(
  orgSlug: string,
  newSiteSlug: string,
  pathname: string,
  sites: readonly { slug: string }[],
): string {
  const seg = pathname.split("/").filter(Boolean); // [org, site?, ...rest]
  const inSite = sites.some((s) => s.slug === seg[1]);
  const rest = inSite ? seg.slice(2).join("/") : "";
  return siteHref(orgSlug, newSiteSlug, rest);
}
