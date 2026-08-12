"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { site } from "@/lib/db/app-schema";
import { findSite } from "@/lib/dashboard-context";
import { revalidateSiteRow } from "@/lib/tenant";
import { siteRoute } from "@/lib/dashboard-nav";
import { parseCustomDomain } from "@/lib/custom-domain";
import { getSession } from "@/lib/session";
import { isPlatformAdminEmail } from "@/lib/platform-admin";
import { addProjectDomain } from "@/lib/vercel-domains";
import { releaseDomain } from "@/lib/domain-reconcile";

export type DomainActionState = { ok?: boolean; error?: string };

// The site these actions mutate, carried from the URL-scoped page (/:org/:site) since a
// server action has no params of its own. findSite re-authorizes it server-side, so the
// client can't target a site the user doesn't own.
export type SiteRef = { org: string; site: string };

// Internal route to revalidate (Next keys the cache by the real /app mount, not the
// rewritten-away public URL).
const domainPath = (ref: SiteRef) =>
  siteRoute(ref.org, ref.site, "settings/domain");

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

export async function setCustomDomain(
  ref: SiteRef,
  input: {
    domain: string;
    subpath: boolean;
  },
): Promise<DomainActionState> {
  const active = await findSite(ref.org, ref.site);
  if (!active) return { error: "No active site." };

  const parsed = parseCustomDomain(input.domain);
  if (!parsed.ok) return { error: parsed.error };

  // A host on Papervine's OWN domain (e.g. docs.{platform}) is claimable — but only by the
  // operator, who actually controls that DNS. Without this check any customer could park
  // their content on a papervine.io subdomain, which is both a brand hijack and puts
  // third-party content back on the domain our cookies are scoped to. Platform-admin is the
  // existing operator identity (SPEC §10.10); no new auth surface.
  if (parsed.requiresOperator) {
    const session = await getSession();
    if (!isPlatformAdminEmail(session?.user?.email, process.env.PLATFORM_ADMIN_EMAILS)) {
      return { error: "That domain belongs to Papervine — enter a domain you control." };
    }
  }

  // Attach to the Vercel project FIRST — this is what makes the platform issue the
  // per-host TLS cert and route the host to us; DNS alone never completes the handshake
  // (SPEC §2). Do it before the DB write so a hard failure (e.g. the host is owned by
  // another project) is surfaced without leaving an unservable domain saved. No-op when
  // Vercel isn't configured (local/CI) — the DNS-only path below still applies.
  const attached = await addProjectDomain(parsed.domain);
  if (!attached.ok) return { error: attached.error };

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

  // If the owner pointed the site at a *different* host, free the old one's project slot —
  // durably, so a failed detach is retried by the reconcile cron rather than orphaned (SPEC §2).
  if (active.customDomain && active.customDomain !== parsed.domain) {
    await releaseDomain(active.customDomain);
  }

  // Try once now so a domain whose DNS is already pointed shows "Connected" immediately.
  await liveCheck(parsed.domain, active.slug, active.id);
  // Drop cached lookups for the slug, the new domain, and the OLD domain (so a changed-away
  // host stops resolving to this site immediately rather than for the TTL window).
  revalidateSiteRow({ slug: active.slug, domains: [parsed.domain, active.customDomain] });
  revalidatePath(domainPath(ref));
  return { ok: true };
}

export async function removeCustomDomain(ref: SiteRef): Promise<DomainActionState> {
  const active = await findSite(ref.org, ref.site);
  if (!active) return { error: "No active site." };

  // Detach from the Vercel project before clearing it locally, so the project-domain slot is
  // freed (SPEC §2 — the per-project cap is finite). Durable: a failed detach is retried by the
  // reconcile cron, so a removed domain never lingers attached.
  if (active.customDomain) await releaseDomain(active.customDomain);

  await db
    .update(site)
    .set({
      customDomain: null,
      customDomainSubpath: false,
      customDomainVerifiedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(site.id, active.id));
  // Drop the removed domain's cached lookup so it stops resolving to this site immediately.
  revalidateSiteRow({ slug: active.slug, domains: [active.customDomain] });
  revalidatePath(domainPath(ref));
  return { ok: true };
}

export async function verifyCustomDomain(ref: SiteRef): Promise<DomainActionState> {
  const active = await findSite(ref.org, ref.site);
  if (!active?.customDomain) return { error: "No domain to verify." };

  const ok = await liveCheck(active.customDomain, active.slug, active.id);
  revalidatePath(domainPath(ref));
  return ok
    ? { ok: true }
    : { error: "Not reachable yet — point your DNS here, then check again." };
}
