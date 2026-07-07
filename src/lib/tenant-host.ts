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

// Hosts Papervine itself answers on — the apex marketing/control plane and every
// preview/dev surface — as opposed to a tenant's own vanity domain (docs.example.com).
const PLATFORM_APEXES = new Set(["papervine.io"]);
const PLATFORM_SUFFIXES = [".localhost", ".papervine.io", ".vercel.app"];

/**
 * Is this Host one Papervine owns (apex, a tenant subdomain, a preview, a dev/test
 * runner) rather than a tenant's custom domain? The middleware uses it to decide
 * whether to attempt custom-domain resolution: everything that is NOT a platform host
 * is treated as a candidate vanity domain (resolved against `site.customDomain`). Pure
 * + import-free so it stays safe in the edge middleware, like `resolveTenantSlug`.
 */
export function isPlatformHost(host: string | null): boolean {
  if (!host) return true;
  const name = host.split(":")[0].toLowerCase();
  if (!name.includes(".")) return true; // bare label (localhost, app) — never a vanity domain
  if (/^[0-9.]+$/.test(name)) return true; // raw IPv4 (127.0.0.1, CI test runners)
  if (PLATFORM_APEXES.has(name)) return true;
  return PLATFORM_SUFFIXES.some((s) => name.endsWith(s));
}

/**
 * The control-plane host — the authenticated app (dashboard + auth), kept off the apex/
 * docs namespace the way hosted docs platforms uses app-host. `app.localhost` in dev,
 * `app.papervine.io` in prod. Requiring a platform host stops a tenant's own
 * `app.example.com` vanity domain from being mistaken for ours. Pure + import-free so it's
 * safe in the edge middleware.
 */
export function isAppHost(host: string | null): boolean {
  if (!host) return false;
  const name = host.split(":")[0].toLowerCase();
  return (name === "app" || name.startsWith("app.")) && isPlatformHost(host);
}

/**
 * The parent domain a cookie should scope to so it's readable across the apex + app host:
 * `app.papervine.io` → `papervine.io`, `app.localhost` → `localhost`. Used only for the
 * benign "signed in" hint (a boolean, never the session token — see SPEC §10), so the
 * marketing apex can show a Dashboard link without the session cookie leaving the app host.
 */
export function parentDomain(host: string): string {
  const name = host.split(":")[0];
  const parts = name.split(".");
  return parts.length <= 1 ? name : parts.slice(1).join(".");
}

/**
 * The app host for a given request host: `app.{apexBase}` (carrying the dev port). Strips
 * a leading `www`/`app` label so a link built on the marketing apex points at the control
 * plane — `papervine.io`/`www.papervine.io` → `app.papervine.io`, `localhost:3000` →
 * `app.localhost:3000`.
 */
export function appHostFor(host: string): string {
  const [name, port] = host.split(":");
  const base = name.replace(/^(www|app)\./, "");
  return port ? `app.${base}:${port}` : `app.${base}`;
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
