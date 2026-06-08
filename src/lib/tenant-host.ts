// Pure host→tenant-slug mapping. No imports — safe in edge middleware (must not
// pull in the DB/node deps that tenant.ts uses).

// Subdomains that address the platform itself, never a tenant.
const RESERVED = new Set(["www", "app", "api", "docs"]);

/**
 * Map a request Host to a tenant slug, or null for the apex/platform host.
 * Local dev uses `{slug}.localhost`; prod uses `{slug}.docbot.app`. Custom domains
 * (a DB lookup) are a follow-up.
 */
export function resolveTenantSlug(host: string | null): string | null {
  if (!host) return null;
  const name = host.split(":")[0].toLowerCase();
  for (const suffix of [".localhost", ".docbot.app"]) {
    if (name.endsWith(suffix)) {
      const label = name.slice(0, -suffix.length);
      if (label && !label.includes(".") && !RESERVED.has(label)) return label;
    }
  }
  return null;
}
