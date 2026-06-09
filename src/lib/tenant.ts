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

/**
 * Resolve the site a request is for from its Host header — the tenant subdomain
 * ({slug}.docbot.app / {slug}.localhost). Returns null on the apex/preview host
 * (DOCBOT_CONTENT single-repo mode), so callers (analytics instrumentation) can
 * safely no-op when there's no tenant.
 */
export async function getSiteByHost(host: string | null) {
  const { resolveTenantSlug } = await import("./tenant-host");
  const slug = resolveTenantSlug(host);
  return slug ? getSiteBySlug(slug) : null;
}
