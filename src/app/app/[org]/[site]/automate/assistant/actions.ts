"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { site } from "@/lib/db/app-schema";
import { findSite } from "@/lib/dashboard-context";
import { revalidateSiteRow } from "@/lib/tenant";
import { siteRoute } from "@/lib/dashboard-nav";

export type AssistantActionState = { ok?: boolean; error?: string };

// The site these actions mutate, carried from the URL-scoped page (/:org/:site) since a
// server action has no params of its own. findSite re-authorizes it server-side.
export type SiteRef = { org: string; site: string };

// Internal route to revalidate (Next keys the cache by the real /app mount, not the
// rewritten-away public URL).
const assistantPath = (ref: SiteRef) =>
  siteRoute(ref.org, ref.site, "automate/assistant");

// Persist an assistant operational toggle (SPEC §8.6 — DB state, not docs.json, so it
// takes effect instantly without a Git commit). Bust the cached site row too so the
// public /api/assistant endpoint sees the new state immediately rather than for the TTL
// window — same instant-effect guarantee as the reader-auth kill switch (§11.2).
async function setAssistantFlag(
  ref: SiteRef,
  set: Partial<typeof site.$inferInsert>,
): Promise<AssistantActionState> {
  const active = await findSite(ref.org, ref.site);
  if (!active) return { error: "No active site." };

  await db
    .update(site)
    .set({ ...set, updatedAt: new Date() })
    .where(eq(site.id, active.id));
  revalidateSiteRow({ slug: active.slug, domains: [active.customDomain] });
  revalidatePath(assistantPath(ref));
  return { ok: true };
}

// Operational kill switch — enable/disable the assistant. Active/Inactive badge tracks it.
export async function setAssistantEnabled(
  ref: SiteRef,
  enabled: boolean,
): Promise<AssistantActionState> {
  return setAssistantFlag(ref, { assistantEnabled: enabled });
}

// Invisible CAPTCHA (hCaptcha) on the public assistant endpoint — bot/abuse protection.
export async function setAssistantCaptchaEnabled(
  ref: SiteRef,
  enabled: boolean,
): Promise<AssistantActionState> {
  return setAssistantFlag(ref, { assistantCaptchaEnabled: enabled });
}
