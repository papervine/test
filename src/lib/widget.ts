import { supportsSubdomainTenants, tenantHostFor } from "@/lib/tenant-host";

/**
 * Pure helpers for the embeddable assistant widget (SPEC §8.7). Kept DB-free so they're
 * unit-testable: `normalizeOrigin` validates/canonicalizes what an owner types into the
 * settings form, `isOriginAllowed` is the exact check the widget chat route runs against
 * every cross-origin request's `Origin` header, and `resolveDocsBaseUrl` computes the
 * tenant's real public docs URL so the widget can rewrite relative citation links against
 * it instead of the customer page's own origin.
 */

/**
 * Validate and canonicalize a user-entered origin: `http(s)://host[:port]` only — no path,
 * query, hash, or wildcard (matches the settings UI's own stated constraint). Returns the
 * canonical origin string (default ports stripped, host lowercased by the URL parser), or
 * null for anything that isn't exactly an origin.
 */
export function normalizeOrigin(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || trimmed.includes("*")) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) return null;
  return url.origin;
}

/** Exact-match the request's Origin header against a site's configured allowlist. */
export function isOriginAllowed(origin: string | null, allowedOrigins: string[]): boolean {
  if (!origin) return false;
  return allowedOrigins.includes(origin);
}

/**
 * The tenant's real public docs URL — same {slug}.{apex} / custom-domain / apex-path-mode
 * decision the dashboard's "Open site" link uses (src/app/app/[org]/[site]/page.tsx). The
 * assistant's system prompt cites pages as relative Markdown links (e.g.
 * "[Quickstart](/quickstart)") — correct on the docs site itself, but the widget renders
 * inside an arbitrary CUSTOMER page, where a bare "/quickstart" resolves against THEIR
 * host, not ours. `host` is the request's own Host header value (no scheme).
 */
export function resolveDocsBaseUrl(
  host: string,
  site: { customDomain: string | null; slug: string },
): string {
  if (site.customDomain) return `https://${site.customDomain}`;
  const proto = host.includes("localhost") ? "http" : "https";
  // The tenant host comes from configuration (tenantHostFor), NOT from stripping `app.`
  // off the requesting host — the widget's citations are minted while serving a customer's
  // page, and deriving from the request would point them at the legacy domain.
  const tenantHost = tenantHostFor(site.slug, host);
  if (supportsSubdomainTenants(tenantHost.replace(/^[^.]+\./, ""))) {
    return `${proto}://${tenantHost}`;
  }
  const apexBase = host.replace(/^(app|www)\./, "");
  return `${proto}://${apexBase}/sites/${site.slug}`;
}
