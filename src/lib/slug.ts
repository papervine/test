// URL-safe slug. Shared by org/site creation (the slug doubles as a subdomain).
// Pure — usable from client and server (not in a "use server" file, which may only
// export async functions).
export function slugify(v: string): string {
  return v
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// Org slugs are path segments on the app host (app.papervine.io/:org), so a slug that
// matches a static control-plane path would be shadowed by it — Next resolves static
// segments before [org] (/admin, /preview), and the middleware handles the auth paths
// and API/app mounts before the bare→/app rewrite ever reaches the route tree. Enforced
// at org creation (beforeCreateOrganization in src/lib/auth.ts).
export const RESERVED_ORG_SLUGS = new Set([
  "admin",
  "preview",
  "api",
  "app",
  "login",
  "signup",
  "onboarding",
  "accept-invite",
]);

export function isReservedOrgSlug(slug: string): boolean {
  return RESERVED_ORG_SLUGS.has(slug);
}

// Slugs a SITE may not take. A site slug is its subdomain on the tenant domain.
//
//  • `connect` sits beside the org-level route (/:org/:site vs /:org/connect), so a site
//    slugged "connect" would be shadowed by that page.
//  • `docs` is ours — we dogfood our own documentation as an ordinary tenant site, and it
//    would otherwise be first-come-first-served.
//
// Deliberately absent: `www`, `app`, `api`. Before tenants moved to their own domain those
// were unassignable *by accident* — the host resolver refused to map them while this list
// let them through, so connecting a repo named "api" created a site whose subdomain
// silently served the marketing page instead of its docs. Nothing of ours answers on the
// tenant domain, so they're ordinary working slugs now. The unit test pins that this list
// and the host resolver agree, which is what silently drifted before.
export const RESERVED_SITE_SLUGS = new Set(["connect", "docs"]);

export function isReservedSiteSlug(slug: string): boolean {
  return RESERVED_SITE_SLUGS.has(slug);
}
