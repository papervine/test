// Pure host→tenant-slug mapping. No imports — safe in edge middleware (must not
// pull in the DB/node deps that tenant.ts uses).

// Subdomains that address the platform itself, never a tenant.
const RESERVED = new Set(["www", "app", "api", "docs"]);

/**
 * Map a request Host to a tenant slug, or null for the apex/platform host.
 * Local dev uses `{slug}.localhost`; prod uses `{slug}.papervine.io`. Custom domains
 * (a DB lookup) are a follow-up. A null return on the apex is also what flips the
 * `/sites/{slug}` route into path-based serving (SPEC §2 "Interim path-based serving").
 */
export function resolveTenantSlug(host: string | null): string | null {
  if (!host) return null;
  const name = host.split(":")[0].toLowerCase();
  for (const suffix of [".localhost", ".papervine.io"]) {
    if (name.endsWith(suffix)) {
      const label = name.slice(0, -suffix.length);
      if (label && !label.includes(".") && !RESERVED.has(label)) return label;
    }
  }
  return null;
}

/**
 * Can tenants be served as `{slug}.{apexBase}` subdomains on this apex host? True only
 * for hosts the resolver actually recognizes (`papervine.io`, `localhost`) — NOT a bare
 * `*.vercel.app`, where nested-subdomain TLS isn't issued and the resolver wouldn't
 * match the suffix anyway. When false, link tenants via the path form (`/sites/{slug}`).
 * Probes the resolver itself so this can never drift from the real routing rules.
 */
export function supportsSubdomainTenants(apexBase: string): boolean {
  return resolveTenantSlug(`probe.${apexBase}`) === "probe";
}
