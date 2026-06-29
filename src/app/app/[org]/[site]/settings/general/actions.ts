"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { site } from "@/lib/db/app-schema";
import { getSession, listOrganizations, getMemberRole } from "@/lib/session";
import { siteRoute } from "@/lib/dashboard-nav";
import { revalidateSiteRow } from "@/lib/tenant";
import { normalizeSiteName } from "@/lib/site-name";

export type SiteRef = { org: string; site: string };
export type GeneralActionState = { ok?: boolean; error?: string };

const generalPath = (ref: SiteRef) => siteRoute(ref.org, ref.site, "settings/general");

/** Rename the site's display name (the label shown across the dashboard). Owner/admin only. */
export async function setSiteName(ref: SiteRef, raw: string): Promise<GeneralActionState> {
  const session = await getSession();
  if (!session) return { error: "Not signed in." };
  const org = (await listOrganizations())?.find((o) => o.slug === ref.org);
  if (!org) return { error: "No active organization." };
  const role = await getMemberRole(org.id, session.user.id);
  if (role !== "owner" && role !== "admin") {
    return { error: "Only an owner or admin can rename this site." };
  }

  const result = normalizeSiteName(raw);
  if ("error" in result) return { error: result.error };

  const [row] = await db
    .select()
    .from(site)
    .where(and(eq(site.organizationId, org.id), eq(site.slug, ref.site)))
    .limit(1);
  if (!row) return { error: "Site not found." };

  await db.update(site).set({ name: result.name, updatedAt: new Date() }).where(eq(site.id, row.id));
  // The name rides the cached site row (SPEC §11.2 move ①), so bust it; revalidate the dashboard
  // layout so the switcher/breadcrumb pick up the rename across pages (not just this one).
  revalidateSiteRow({ slug: row.slug, domains: [row.customDomain] });
  revalidatePath(siteRoute(ref.org, ref.site, ""), "layout");
  revalidatePath(generalPath(ref));
  return { ok: true };
}
