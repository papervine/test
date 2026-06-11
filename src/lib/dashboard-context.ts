import "server-only";
import { notFound, redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { getMemberRole, getSession, listOrganizations } from "@/lib/session";
import { db } from "@/lib/db";
import { site } from "@/lib/db/app-schema";

// The dashboard is URL-scoped (SPEC §10): the org and site live in the path
// (/:org/:site/…), not a cookie. These helpers resolve + authorize that path so the
// [org] layout, per-site pages, and the settings server actions all agree on who can
// see what. Membership is the gate — a user can only reach orgs they belong to, and
// sites are org-scoped, so a resolved site row is one the caller may read and mutate.

export type SiteRow = typeof site.$inferSelect;
type SiteListItem = { id: string; slug: string; name: string };

export type OrgContext = {
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>;
  org: { id: string; slug: string; name: string };
  role: string | null;
  sites: SiteListItem[];
};

export type SiteContext = OrgContext & { site: SiteRow };

/**
 * Resolve the org named in the URL, for a layout/page. Redirects signed-out users to
 * /login and org-less users to /onboarding; 404s when the user isn't a member of the
 * requested org (so one tenant can't probe another's slug). Returns the org, the
 * viewer's role, and the org's sites (oldest-first, for the switcher).
 */
export async function requireOrg(orgSlug: string): Promise<OrgContext> {
  const session = await getSession();
  if (!session) redirect("/login");

  const orgs = await listOrganizations();
  if (!orgs?.length) redirect("/onboarding");
  const match = orgs.find((o) => o.slug === orgSlug);
  if (!match) notFound();

  const org = { id: match.id, slug: match.slug, name: match.name };
  const sites = await db
    .select({ id: site.id, slug: site.slug, name: site.name })
    .from(site)
    .where(eq(site.organizationId, org.id))
    .orderBy(asc(site.createdAt));
  const role = await getMemberRole(org.id, session.user.id);
  return { session, org, role, sites };
}

/**
 * Resolve a specific site under an org, for a per-site page (full row). 404s when the
 * site doesn't exist under the user's org — same authorization as requireOrg, plus the
 * site lookup.
 */
export async function requireSite(
  orgSlug: string,
  siteSlug: string,
): Promise<SiteContext> {
  const ctx = await requireOrg(orgSlug);
  const [row] = await db
    .select()
    .from(site)
    .where(and(eq(site.organizationId, ctx.org.id), eq(site.slug, siteSlug)))
    .limit(1);
  if (!row) notFound();
  return { ...ctx, site: row };
}

/**
 * Non-throwing site lookup for server actions, which return an error state rather than
 * rendering a 404. Authorizes the same way (session → org membership → org-scoped site),
 * returning the full row or null. Callers that get a row back may mutate it.
 */
export async function findSite(
  orgSlug: string,
  siteSlug: string,
): Promise<SiteRow | null> {
  const session = await getSession();
  if (!session) return null;
  const org = (await listOrganizations())?.find((o) => o.slug === orgSlug);
  if (!org) return null;
  const [row] = await db
    .select()
    .from(site)
    .where(and(eq(site.organizationId, org.id), eq(site.slug, siteSlug)))
    .limit(1);
  return row ?? null;
}
