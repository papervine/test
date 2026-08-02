"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { site } from "@/lib/db/app-schema";
import { findSite } from "@/lib/dashboard-context";
import { revalidateSiteRow } from "@/lib/tenant";
import { siteRoute } from "@/lib/dashboard-nav";
import { normalizeOrigin } from "@/lib/widget";

export type WidgetActionState = { ok?: boolean; error?: string };

// The site these actions mutate, carried from the URL-scoped page (/:org/:site) since a
// server action has no params of its own. findSite re-authorizes it server-side, so the
// client can't target a site the user doesn't own.
export type SiteRef = { org: string; site: string };

const widgetPath = (ref: SiteRef) => siteRoute(ref.org, ref.site, "settings/widget");

/** A site created before this feature shipped has no widgetId yet — mint one on first
 *  visit to the settings page rather than backfilling every row in the migration
 *  (Postgres allows unlimited NULLs under a unique constraint, so this is safe to defer).
 *  Called directly from the settings page's render, so it must NOT call revalidateTag
 *  (illegal during render) — harmless here since a freshly-minted id has no stale cached
 *  lookup to invalidate; nothing could have looked it up before it existed. */
export async function ensureWidgetId(ref: SiteRef): Promise<string | null> {
  const active = await findSite(ref.org, ref.site);
  if (!active) return null;
  if (active.widgetId) return active.widgetId;

  const widgetId = `widget_${randomUUID()}`;
  await db.update(site).set({ widgetId }).where(eq(site.id, active.id));
  return widgetId;
}

export async function setWidgetEnabled(
  ref: SiteRef,
  enabled: boolean,
): Promise<WidgetActionState> {
  const active = await findSite(ref.org, ref.site);
  if (!active) return { error: "No active site." };

  await db
    .update(site)
    .set({ widgetEnabled: enabled, updatedAt: new Date() })
    .where(eq(site.id, active.id));
  revalidateSiteRow({ slug: active.slug, widgetId: active.widgetId });
  revalidatePath(widgetPath(ref));
  return { ok: true };
}

export async function setWidgetAllowedOrigins(
  ref: SiteRef,
  origins: string[],
): Promise<WidgetActionState> {
  const active = await findSite(ref.org, ref.site);
  if (!active) return { error: "No active site." };

  const normalized: string[] = [];
  for (const raw of origins) {
    const origin = normalizeOrigin(raw);
    if (!origin) return { error: `"${raw}" isn't a valid origin. Use https://docs.example.com — no paths or wildcards.` };
    if (!normalized.includes(origin)) normalized.push(origin);
  }

  await db
    .update(site)
    .set({ widgetAllowedOrigins: normalized, updatedAt: new Date() })
    .where(eq(site.id, active.id));
  revalidateSiteRow({ slug: active.slug, widgetId: active.widgetId });
  revalidatePath(widgetPath(ref));
  return { ok: true };
}
