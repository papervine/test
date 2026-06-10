import "server-only";
import { cookies } from "next/headers";
import { asc, eq } from "drizzle-orm";
import { getSession, listOrganizations } from "@/lib/session";
import { db } from "@/lib/db";
import { site } from "@/lib/db/app-schema";
import { ACTIVE_SITE_COOKIE, resolveActiveSite } from "@/lib/active-site";

export type ActiveSite = typeof site.$inferSelect;

/**
 * The full site row the dashboard is currently scoped to — session → first org → the
 * active site (cookie, else oldest), the same resolution the (app) layout uses for the
 * switcher. Returns null when there's no session/org/site so per-site pages and actions
 * (Domain setup, MCP) can bail safely. The site is org-scoped, so callers don't need a
 * separate ownership check before mutating it.
 */
export async function requireActiveSite(): Promise<ActiveSite | null> {
  const session = await getSession();
  if (!session) return null;
  const orgs = await listOrganizations();
  const activeOrg = orgs?.[0];
  if (!activeOrg) return null;

  const sites = await db
    .select()
    .from(site)
    .where(eq(site.organizationId, activeOrg.id))
    .orderBy(asc(site.createdAt));
  const cookieSlug = (await cookies()).get(ACTIVE_SITE_COOKIE)?.value;
  return resolveActiveSite(sites, cookieSlug);
}
