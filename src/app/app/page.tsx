import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { getSession, listOrganizations } from "@/lib/session";
import { db } from "@/lib/db";
import { site } from "@/lib/db/app-schema";
import { siteBase, connectHref } from "@/lib/dashboard-nav";

// The app host's root (app.papervine.io/) — no UI of its own. The dashboard is URL-scoped
// (SPEC §10: /:org/:site), so this is the one place that picks a default: the user's org +
// first site, forwarding there. (Post-login lands here; the middleware gates it cheaply
// for signed-out visitors.) Reached internally as /app via the app-host rewrite.
export default async function DashboardEntry() {
  const session = await getSession();
  if (!session) redirect("/login");
  const org = (await listOrganizations())?.[0];
  if (!org) redirect("/onboarding");

  const [first] = await db
    .select({ slug: site.slug })
    .from(site)
    .where(eq(site.organizationId, org.id))
    .orderBy(asc(site.createdAt))
    .limit(1);
  redirect(first ? siteBase(org.slug, first.slug) : connectHref(org.slug));
}
