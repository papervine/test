"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { site, deletionFeedback } from "@/lib/db/app-schema";
import { getSession, listOrganizations, getMemberRole } from "@/lib/session";
import { deletePrefix } from "@/lib/storage";
import { removeProjectDomain } from "@/lib/vercel-domains";
import { isReasonValid, planResourceCleanup } from "@/lib/danger-zone";
import type { SiteResources } from "@/lib/danger-zone";

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
      await removeProjectDomain(domain);
    } catch (e) {
      console.error(`[danger] failed to detach domain ${domain} (continuing)`, e);
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
