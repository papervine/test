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
