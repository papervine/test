"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { site } from "@/lib/db/app-schema";
import { requireActiveSite } from "@/lib/require-active-site";
import { parseCustomDomain } from "@/lib/custom-domain";

export type DomainActionState = { ok?: boolean; error?: string };

const DOMAIN_PATH = "/dashboard/settings/domain";

// Postgres unique-violation — another site already claimed this domain.
function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: string })?.code === "23505";
}

/**
 * Live check: does {domain}/api/site-identity report this slug? Proves DNS actually
 * points the vanity host at us, at the right site. Stamps customDomainVerifiedAt on
 * success; silently leaves it null otherwise (pending DNS). Best-effort — a failed
 * fetch (DNS not propagated yet) is the normal not-yet-connected case, not an error.
 */
async function liveCheck(domain: string, slug: string, siteId: string): Promise<boolean> {
  try {
    const res = await fetch(`https://${domain}/api/site-identity`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { site?: string | null };
    if (data.site !== slug) return false;
  } catch {
    return false;
  }
  await db
    .update(site)
    .set({ customDomainVerifiedAt: new Date() })
    .where(eq(site.id, siteId));
  return true;
}

export async function setCustomDomain(input: {
  domain: string;
  subpath: boolean;
}): Promise<DomainActionState> {
  const active = await requireActiveSite();
  if (!active) return { error: "No active site." };

  const parsed = parseCustomDomain(input.domain);
  if (!parsed.ok) return { error: parsed.error };

  try {
    await db
      .update(site)
      .set({
        customDomain: parsed.domain,
        customDomainSubpath: input.subpath,
        // Re-saving resets verification — the domain or its hosting mode changed, so
        // the prior "Connected" no longer necessarily holds until we re-check.
        customDomainVerifiedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(site.id, active.id));
  } catch (e) {
    if (isUniqueViolation(e))
      return { error: "That domain is already connected to another site." };
    throw e;
  }

  // Try once now so a domain whose DNS is already pointed shows "Connected" immediately.
  await liveCheck(parsed.domain, active.slug, active.id);
  revalidatePath(DOMAIN_PATH);
  return { ok: true };
}

export async function removeCustomDomain(): Promise<DomainActionState> {
  const active = await requireActiveSite();
  if (!active) return { error: "No active site." };

  await db
    .update(site)
    .set({
      customDomain: null,
      customDomainSubpath: false,
      customDomainVerifiedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(site.id, active.id));
  revalidatePath(DOMAIN_PATH);
  return { ok: true };
}

export async function verifyCustomDomain(): Promise<DomainActionState> {
  const active = await requireActiveSite();
  if (!active?.customDomain) return { error: "No domain to verify." };

  const ok = await liveCheck(active.customDomain, active.slug, active.id);
  revalidatePath(DOMAIN_PATH);
  return ok
    ? { ok: true }
    : { error: "Not reachable yet — point your DNS here, then check again." };
}
