import "server-only";
import { notFound, redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { getMemberRole, getSession, listOrganizations } from "@/lib/session";
import { isPlatformAdminEmail } from "@/lib/platform-admin";
import { db } from "@/lib/db";
import { organization } from "@/lib/db/schema";
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
  // True when the viewer isn't a member and got in via the platform-admin bypass
  // (SPEC §10.10): a read-only cross-tenant view. role is null in that case, so the
  // role-gated manage UI naturally degrades to viewer; drives the banner in the shell.
  platformAdminView: boolean;
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
  const match = orgs?.find((o) => o.slug === orgSlug);

  // Platform-admin bypass (SPEC §10.10): an allowlisted operator may VIEW any org's
  // dashboard without being a member. Read-only by construction — role stays null, so
  // every owner/admin-gated control hides, and the mutation path (findSite + the
  // membership-scoped server actions) still requires real membership. Checked only
  // after the membership miss, so a member's own role always wins.
  if (!match) {
    if (
      isPlatformAdminEmail(session.user.email, process.env.PLATFORM_ADMIN_EMAILS)
    ) {
      const [row] = await db
        .select({
          id: organization.id,
          slug: organization.slug,
          name: organization.name,
        })
        .from(organization)
        .where(eq(organization.slug, orgSlug))
        .limit(1);
      if (!row) notFound();
      const sites = await orgSites(row.id);
      return { session, org: row, role: null, sites, platformAdminView: true };
    }
    if (!orgs?.length) redirect("/onboarding");
    notFound();
  }

  const org = { id: match.id, slug: match.slug, name: match.name };
  const sites = await orgSites(org.id);
  const role = await getMemberRole(org.id, session.user.id);
  return { session, org, role, sites, platformAdminView: false };
}

function orgSites(organizationId: string): Promise<SiteListItem[]> {
  return db
    .select({ id: site.id, slug: site.slug, name: site.name })
    .from(site)
    .where(eq(site.organizationId, organizationId))
    .orderBy(asc(site.createdAt));
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
 * Gate for the /admin platform surface (SPEC §10.10): the signed-in user must be on the
 * PLATFORM_ADMIN_EMAILS allowlist (src/lib/platform-admin.ts). 404s — not 403s —
 * non-admins, so the surface is invisible to probing, the same posture as requireOrg's
 * cross-tenant notFound.
 */
export async function requirePlatformAdmin() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (
    !isPlatformAdminEmail(
      session.user.email,
      process.env.PLATFORM_ADMIN_EMAILS,
    )
  ) {
    notFound();
  }
  return session;
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
