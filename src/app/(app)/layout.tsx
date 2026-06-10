import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { getSession, listOrganizations } from "@/lib/session";
import { db } from "@/lib/db";
import { site } from "@/lib/db/app-schema";
import { ACTIVE_SITE_COOKIE, resolveActiveSite } from "@/lib/active-site";
import { AppRail } from "@/components/app/AppRail";
import { PlatformShell } from "@/components/platform/PlatformShell";

// Control-plane shell (SPEC §9). Gates every /dashboard, /settings… route on a
// session — the middleware does the cheap cookie check; this is the real one.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const orgs = await listOrganizations();
  const activeOrg = orgs?.[0] ?? null;
  if (!activeOrg) redirect("/onboarding");

  // Sites feed the top-left switcher; the active one (cookie, else first) scopes the
  // per-site pages (SPEC §10). Oldest-first so "first" is stable as sites are added.
  const sites = await db
    .select({ slug: site.slug, name: site.name })
    .from(site)
    .where(eq(site.organizationId, activeOrg.id))
    .orderBy(asc(site.createdAt));
  const cookieSlug = (await cookies()).get(ACTIVE_SITE_COOKIE)?.value;
  const activeSite = resolveActiveSite(sites, cookieSlug);

  // "lite" atmosphere: the soft top glow carries the brand, but no grid/grain behind
  // the data-dense dashboard tables and forms.
  return (
    <PlatformShell variant="lite">
      <div className="flex min-h-screen">
        <AppRail sites={sites} activeSlug={activeSite?.slug ?? null} userName={session.user.name} />
        <div className="flex-1 overflow-auto">{children}</div>
      </div>
    </PlatformShell>
  );
}
