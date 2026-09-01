import "server-only";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "./db";
import { deployment } from "./db/app-schema";
import { deletePrefix, listKeys } from "./storage";
import { planRevisionGc, revisionPrefix, REVISIONS_PER_SITE } from "./revisions";

/**
 * The DB half of revisions (SPEC §10.11) — the pure rules live in `revisions.ts`.
 */

/** Revision ids this site has produced, newest first — the GC input and the rollback menu. */
export async function listSiteRevisions(
  siteId: string,
  limit = 100,
): Promise<{ deploymentId: string; revisionId: string; commitSha: string | null }[]> {
  const rows = await db
    .select({
      deploymentId: deployment.id,
      revisionId: deployment.revisionId,
      commitSha: deployment.commitSha,
    })
    .from(deployment)
    .where(
      and(
        eq(deployment.siteId, siteId),
        eq(deployment.status, "successful"),
        eq(deployment.target, "live"),
        isNotNull(deployment.revisionId),
      ),
    )
    .orderBy(desc(deployment.createdAt))
    .limit(limit);
  return rows.filter((r): r is typeof r & { revisionId: string } => Boolean(r.revisionId));
}

/**
 * Drop revision trees beyond the retention window.
 *
 * Best-effort and never allowed to throw: it runs AFTER the pointer flip, so by the time we get
 * here the deploy has already succeeded and readers are already being served. A storage hiccup
 * during cleanup must not turn a live deployment into a reported failure — the orphaned prefix
 * costs a little storage and the next deploy sweeps it.
 *
 * `liveRevisionId` is passed explicitly rather than re-read, because the caller has just flipped
 * it and a cached site row would name the PREVIOUS revision — deleting the tree being served.
 */
export async function pruneSiteRevisions(
  siteId: string,
  liveRevisionId: string,
  keep = REVISIONS_PER_SITE,
): Promise<void> {
  try {
    const revisions = await listSiteRevisions(siteId);
    const prune = planRevisionGc({
      siteId,
      ordered: revisions.map((r) => r.revisionId),
      liveRevisionId,
      keep,
    });
    for (const prefix of prune) await deletePrefix(prefix);
  } catch (e) {
    console.error(`[revisions] prune failed site=${siteId} (continuing)`, e);
  }
}

/**
 * Does this revision's tree still exist in storage?
 *
 * Checked before offering or performing a rollback: a deployment row outlives the bytes it
 * points at once GC has run, and "restored" content that turns out to be an empty prefix would
 * take the site down rather than save it. One LIST, capped — we only need to know it's non-empty.
 */
export async function revisionExists(siteId: string, revisionId: string): Promise<boolean> {
  const keys = await listKeys(revisionPrefix(siteId, revisionId));
  return keys.length > 0;
}
