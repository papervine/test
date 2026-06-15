import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { site } from "./db/app-schema";

export { resolveTenantSlug } from "./tenant-host";

export const getSiteBySlug = cache(async (slug: string) => {
  const rows = await db.select().from(site).where(eq(site.slug, slug)).limit(1);
  return rows[0] ?? null;
});

// Resolve a site by its vanity domain (the host the owner pointed at us, e.g.
// docs.acme.com). Cached per-request like getSiteBySlug, since the _domain render,
// its assets, and instrumentation all look the same site up in one request.
export const getSiteByCustomDomain = cache(async (host: string) => {
  const name = host.split(":")[0].toLowerCase();
  const rows = await db
    .select()
    .from(site)
    .where(eq(site.customDomain, name))
    .limit(1);
  return rows[0] ?? null;
});

/**
 * Resolve the site a request is for from its Host header — a tenant subdomain
 * ({slug}.papervine.io / {slug}.localhost) or a connected custom domain
 * (docs.acme.com). Returns null on the apex/preview host (PAPERVINE_CONTENT
 * single-repo mode) and for an unknown host, so callers (the /mcp + llms surfaces,
 * analytics instrumentation) safely no-op when there's no tenant.
 */
export async function getSiteByHost(host: string | null) {
  if (!host) return null;
  try {
    const { resolveTenantSlug } = await import("./tenant-host");
    const slug = resolveTenantSlug(host);
    if (slug) return await getSiteBySlug(slug);
    return await getSiteByCustomDomain(host);
  } catch {
    // No reachable DB (e.g. the DB-free smoke job / a transient outage) → behave
    // like "no tenant": callers no-op (logging off, default content source) rather
    // than rejecting the request. Honors this function's documented no-op contract.
    return null;
  }
}
