"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { site, deletionFeedback, githubInstallation } from "@/lib/db/app-schema";
import { getSession, listOrganizations, getMemberRole } from "@/lib/session";
import { deletePrefix } from "@/lib/storage";
import { releaseDomain } from "@/lib/domain-reconcile";
import { isReasonValid, planResourceCleanup } from "@/lib/danger-zone";
import type { SiteResources } from "@/lib/danger-zone";
import { canManageSites, installationCarries } from "@/lib/transfer-site";
import { revalidateSiteRow } from "@/lib/tenant";

// The site these actions target, carried from the URL-scoped page (/:org/:site) since a
// server action has no params of its own; the action re-authorizes it server-side.
export type SiteRef = { org: string; site: string };

// Both deletes are cross-context redirects (the action mutates on the app host, then the
// client hard-navigates), so — like connectRepo — we return the bare target rather than
// server-redirect(): a soft RSC redirect skips the app-host Host rewrite (the documented
// tenant-URL gotcha) and lands on the apex. The client does window.location.assign.
export type DeleteState = { error?: string; redirectTo?: string };

// Snapshot the exit-survey reason BEFORE we delete the subject — afterwards its id/name
// are gone (no FK, by design; see deletionFeedback). Best-effort: a survey write must
// never block the delete the user asked for, so its failure is swallowed.
async function recordFeedback(
  scope: "site" | "organization",
  subjectId: string,
  subjectName: string,
  reason: string,
  actorUserId: string,
): Promise<void> {
  try {
    await db.insert(deletionFeedback).values({
      id: randomUUID(),
      scope,
      subjectId,
      subjectName,
      reason: reason.trim(),
      actorUserId,
    });
  } catch (e) {
    console.error(`[danger] failed to record ${scope} deletion feedback`, e);
  }
}

// Sweep one site's out-of-band resources before its row goes away. Best-effort by design:
// the user asked to delete this, and a leaked storage prefix or Vercel domain slot is
// recoverable, but a half-deleted row that won't go away isn't — so a cleanup failure is
// logged and the delete proceeds. (deletePrefix can throw on an S3 error; removeProjectDomain
// already swallows its own — the wrapper makes both uniformly non-fatal.) Detach domains
// first to free the finite per-project slot (SPEC §2), then sweep storage.
async function cleanupSiteResources(sites: SiteResources[]): Promise<void> {
  const { storagePrefixes, domainsToDetach } = planResourceCleanup(sites);
  for (const domain of domainsToDetach) {
    try {
      // Durable detach (SPEC §2): enqueues a tombstone + tries inline, so a failed call is
      // retried by the reconcile cron instead of orphaning the host on the deleted site.
      await releaseDomain(domain);
    } catch (e) {
      console.error(`[danger] failed to enqueue domain detach ${domain} (continuing)`, e);
    }
  }
  for (const prefix of storagePrefixes) {
    try {
      await deletePrefix(prefix);
    } catch (e) {
      console.error(`[danger] failed to sweep ${prefix} (continuing)`, e);
    }
  }
}

// Delete one site (the incumbent's "deployment"). Owner/admin only. The Postgres FK cascade
// drops deployments + analytics; storage and the Vercel domain don't cascade, so
// cleanupSiteResources sweeps them explicitly. Lands on the bare org, which forwards to
// the next site (or the connect form when none remain).
export async function deleteSite(
  ref: SiteRef,
  reason: string,
): Promise<DeleteState> {
  const session = await getSession();
  if (!session) return { error: "Not signed in." };
  if (!isReasonValid(reason)) return { error: "A reason is required." };

  const org = (await listOrganizations())?.find((o) => o.slug === ref.org);
  if (!org) return { error: "No active organization." };

  const role = await getMemberRole(org.id, session.user.id);
  if (role !== "owner" && role !== "admin") {
    return { error: "Only an owner or admin can delete a site." };
  }

  const [row] = await db
    .select()
    .from(site)
    .where(and(eq(site.organizationId, org.id), eq(site.slug, ref.site)))
    .limit(1);
  if (!row) return { error: "Site not found." };

  await recordFeedback("site", row.id, row.name, reason, session.user.id);
  // Out-of-band cleanup before the row goes away (it's the only key to find these): detach
  // the Vercel domain + sweep storage, both best-effort so neither can block the delete.
  await cleanupSiteResources([{ id: row.id, customDomain: row.customDomain }]);
  await db.delete(site).where(eq(site.id, row.id));
  // Drop cached lookups so the deleted site stops resolving immediately (a stale cache entry
  // would keep serving it for the TTL window).
  revalidateSiteRow({ slug: row.slug, domains: [row.customDomain] });

  return { redirectTo: `/${org.slug}` };
}

// Delete the whole organization — every site, member, and row under it. Owner only (Better
// Auth's organization:delete permission also enforces this server-side). We sweep each
// site's storage first, then hand off to Better Auth, whose org-row delete fires our FK
// cascade (sites → deployments/analytics, installs). Lands on the app root, which forwards
// to the user's next org or onboarding.
export async function deleteOrganization(
  ref: SiteRef,
  reason: string,
): Promise<DeleteState> {
  const session = await getSession();
  if (!session) return { error: "Not signed in." };
  if (!isReasonValid(reason)) return { error: "A reason is required." };

  const org = (await listOrganizations())?.find((o) => o.slug === ref.org);
  if (!org) return { error: "No active organization." };

  const role = await getMemberRole(org.id, session.user.id);
  if (role !== "owner") {
    return { error: "Only the organization owner can delete it." };
  }

  await recordFeedback("organization", org.id, org.name, reason, session.user.id);

  // Sweep every site's out-of-band resources (storage + Vercel domains) before the rows
  // cascade away — afterwards there's no key to find them. The cascade handles the DB;
  // this handles the bucket and the domain slots.
  const sites = await db
    .select({ id: site.id, customDomain: site.customDomain })
    .from(site)
    .where(eq(site.organizationId, org.id));
  await cleanupSiteResources(sites);

  try {
    await auth.api.deleteOrganization({
      body: { organizationId: org.id },
      headers: await headers(),
    });
  } catch (e) {
    console.error(`[danger] deleteOrganization failed for ${org.id}`, e);
    return { error: "Couldn't delete the organization. Please try again." };
  }

  return { redirectTo: "/" };
}

// Transfer a site to another organization the actor also administers (Vercel-style: both
// ends are the same user, so no acceptance handshake — transferring to an org you DON'T
// belong to would need a pending-invite flow, deliberately out of scope). Owner/admin on
// BOTH ends. Everything keyed off site.id travels with the row for free — deployments,
// analytics, editor sessions/drafts (FK cascade chains), the `sites/{id}/` storage prefix,
// and the custom domain (attached to the shared Vercel project, recorded on the row). The
// one org-owned link is the GitHub App installation: it stays only if the destination org
// holds the same installation, else it's dropped (public/PAT sites sync on; App-connected
// private repos need a reconnect in the new org — the UI says so).
export async function transferSite(
  ref: SiteRef,
  destOrgSlug: string,
): Promise<DeleteState> {
  const session = await getSession();
  if (!session) return { error: "Not signed in." };

  const orgs = await listOrganizations();
  const src = orgs?.find((o) => o.slug === ref.org);
  if (!src) return { error: "No active organization." };
  const dest = orgs?.find((o) => o.slug === destOrgSlug);
  if (!dest) return { error: "You're not a member of the destination organization." };
  if (dest.id === src.id) {
    return { error: "The site already belongs to this organization." };
  }

  const [srcRole, destRole] = await Promise.all([
    getMemberRole(src.id, session.user.id),
    getMemberRole(dest.id, session.user.id),
  ]);
  if (!canManageSites(srcRole)) {
    return { error: "Only an owner or admin can transfer a site." };
  }
  if (!canManageSites(destRole)) {
    return {
      error: "You must be an owner or admin of the destination organization.",
    };
  }

  const [row] = await db
    .select()
    .from(site)
    .where(and(eq(site.organizationId, src.id), eq(site.slug, ref.site)))
    .limit(1);
  if (!row) return { error: "Site not found." };

  let installationId = row.githubInstallationId;
  if (installationId != null) {
    const destInstalls = await db
      .select({ installationId: githubInstallation.installationId })
      .from(githubInstallation)
      .where(eq(githubInstallation.organizationId, dest.id));
    if (!installationCarries(installationId, destInstalls.map((i) => i.installationId))) {
      installationId = null;
    }
  }

  await db
    .update(site)
    .set({
      organizationId: dest.id,
      githubInstallationId: installationId,
      updatedAt: new Date(),
    })
    .where(eq(site.id, row.id));
  // The cached tenant row carries organizationId — bust it so anything reading org off the
  // resolved site sees the new owner immediately, not after the TTL.
  revalidateSiteRow({ slug: row.slug, domains: [row.customDomain] });

  return { redirectTo: `/${dest.slug}/${row.slug}` };
}
