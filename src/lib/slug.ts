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
