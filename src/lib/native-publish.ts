import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "./db";
import { site as siteTable, deployment } from "./db/app-schema";
import { findOpenSession, listDraftFiles, closeSession } from "./draft-store";
import { putObject, listKeys, copyObject } from "./storage";
import {
  liveContentPrefix,
  planRevisionWrite,
  revisionPrefix,
  runPool,
  COPY_CONCURRENCY,
} from "./revisions";
import { pruneSiteRevisions } from "./revision-store";
import { recordPageVersions } from "./page-history-store";
import { planNativePublish } from "./native-publish-plan";
import { openDeployment, resolveDeployment, markSiteLive } from "./deployment-log";
import { revalidateSite } from "./s3-source";
import { syncInFlight } from "./overview";
import { syncErrorDetail } from "./sync-error";
import type { PublishResult } from "./publish-mode";

type SiteRow = typeof siteTable.$inferSelect;

/**
 * Publishing for a Papervine-hosted site (SPEC §10.11) — the storage counterpart to
 * `authoring-core.publishDraft`'s commit/PR paths. The draft buffer IS the source of truth
 * here, so publishing means copying it into the site's object-storage prefix; no GitHub
 * credentials are involved anywhere in this file.
 *
 * Deliberately its own module rather than another branch inside `authoring-core.ts`: that
 * module imports the whole GitHub surface, and adding storage + deployment-log imports
 * there would force every existing test of it to mock modules it doesn't exercise.
 * `authoring-core` imports this; this must never import `authoring-core`.
 *
 * **Guarantee: ATOMIC as of revisions (SPEC §10.11).** A publish builds a whole new immutable
 * tree at `revs/{id}/{deployment}/` and then flips `site.liveRevisionId` in one UPDATE, so a
 * reader is served either the entire old revision or the entire new one — never a half-written
 * mixture, which is what writing into the live prefix used to risk. A crash before the flip
 * leaves an orphan tree nobody points at (GC sweeps it) and the session stays OPEN, so the
 * drafts survive and re-publishing is idempotent.
 *
 * Nothing is ever deleted: a tombstoned draft is simply not carried into the new revision. That
 * is what makes the previous revision a complete tree to roll back to.
 *
 * The remaining race is a LOST UPDATE, not a torn tree: two concurrent publishes build separate
 * revisions and the later flip wins, discarding the other's work rather than interleaving with
 * it. The `syncInFlight` window below still guards the common case; `pg_advisory_xact_lock`
 * (SPEC §3) is still the real fix.
 */
export async function publishNative(
  site: SiteRow,
  branch: string,
  opts: {
    message?: string;
    actorUserId?: string | null;
    /**
     * Who is publishing. 'automation' suppresses the content_update fan-out so an
     * automation that publishes can't re-trigger itself — see markSiteLive.
     */
    origin?: "editor" | "automation";
  } = {},
): Promise<PublishResult> {
  const session = await findOpenSession(site.id, branch);
  // Same wording as the Git path: from the editor's point of view nothing differs.
  if (!session) return { ok: false, error: "No open edit session for this branch." };

  const drafts = await listDraftFiles(session.id);
  if (drafts.length === 0) return { ok: false, error: "No changes to publish." };

  // INTERIM concurrency guard, reusing the mechanism the Re-sync button and Git settings
  // already use rather than inventing a second one. Revisions removed the torn-tree failure
  // mode this was written for; what's left is two publishes racing to flip the pointer, where
  // the loser's work is silently discarded. A `building` row older than the window is an
  // orphaned killed run and must not block publishing forever.
  const [building] = await db
    .select({ createdAt: deployment.createdAt })
    .from(deployment)
    .where(and(eq(deployment.siteId, site.id), eq(deployment.status, "building")))
    .orderBy(desc(deployment.createdAt))
    .limit(1);
  if (syncInFlight(building?.createdAt.getTime() ?? null)) {
    return { ok: false, conflict: true, error: "A publish is already in progress — give it a moment." };
  }

  const message = opts.message?.trim() || "Published from the editor";
  const startedAt = Date.now();
  const deploymentId = await openDeployment({
    siteId: site.id,
    trigger: "publish",
    commitMessage: message,
    actorUserId: opts.actorUserId ?? null,
  });

  try {
    // Build a NEW revision rather than overwriting the live one. Nothing here is visible to a
    // reader until markSiteLive flips the pointer below, which is what finally makes a hosted
    // publish atomic — the phased ordering that used to be a damage-limitation measure is now
    // just belt-and-braces, and a crash leaves an orphan tree nobody points at.
    const fromPrefix = liveContentPrefix(site);
    const toPrefix = revisionPrefix(site.id, deploymentId);

    // One list call: classifies added-vs-modified for the feed AND supplies the carry-forward
    // set, rather than a getObjectText per file the way listSessionChanges does.
    const existingPaths = new Set(
      (await listKeys(fromPrefix)).map((k) => k.slice(fromPrefix.length)).filter(Boolean),
    );
    const plan = planNativePublish(toPrefix, drafts, existingPaths, session.id);

    // Phase 1: pages and assets. Phase 2: the config, so nav never precedes its pages.
    await Promise.all([
      ...plan.puts.map((w) => putObject(w.key, w.content, w.contentType)),
      // Uploaded assets: a server-side copy, so the bytes never travel through this process.
      ...plan.copies.map((c) => copyObject(c.from, c.to)),
    ]);
    for (const w of plan.configPuts) await putObject(w.key, w.content, w.contentType);

    // Phase 3: carry forward everything this publish didn't touch. A tombstoned draft is simply
    // absent from the new revision — there is no delete anywhere, which is exactly why the
    // previous revision remains a complete, rollback-able tree.
    const { copies: carried } = planRevisionWrite({
      fromPrefix,
      toPrefix,
      keep: [...existingPaths],
      written: plan.writtenPaths,
      removed: plan.removedPaths,
    });
    await runPool(carried, COPY_CONCURRENCY, (c) => copyObject(c.from, c.to));

    // One version row per changed page (SPEC §10.11), from the same plan that just wrote the
    // objects. Revisions now retain the previous bytes too, but this stays: it's PER-PAGE
    // history for the editor's History panel (restore one page into a draft), a different
    // granularity from restoring a whole deployment. Never allowed to throw — losing a history
    // row is a far smaller problem than a publish that reports failure once bytes are written.
    await recordPageVersions({
      siteId: site.id,
      pages: plan.puts.map((w) => ({ path: w.key.slice(toPrefix.length), content: w.content })),
      actorUserId: opts.actorUserId ?? null,
      deploymentId,
    });

    // Serve the new bytes immediately instead of the pre-publish copy.
    revalidateSite(site.id);
    await closeSession(session.id, "published");
    // Promotes to live and bumps updatedAt — which for a hosted site is the ENTIRE content
    // cache version key (its commit sha is null forever), so this is what makes the publish
    // visible at all. The deployment id is the automation dedupe ref: stable across a retry
    // of this publish, unlike the random fallback that would let an automation re-fire.
    await markSiteLive(site, {
      revisionId: deploymentId,
      fireAutomations: opts.origin !== "automation",
      fallbackRef: deploymentId,
    });
    await pruneSiteRevisions(site.id, deploymentId);
    await resolveDeployment(deploymentId, {
      siteId: site.id,
      ok: true,
      commitMessage: message,
      // The revision this publish built and just pointed the site at. Without it the row
      // can't offer a Roll back later — the site would serve revisions it has no record of.
      revisionId: deploymentId,
      filesAdded: plan.added,
      filesEdited: plan.modified,
      durationMs: Date.now() - startedAt,
    });
    return {
      ok: true,
      mode: "native",
      files: plan.puts.length + plan.configPuts.length,
      deploymentId,
    };
  } catch (e) {
    console.error(`[publish] native publish failed site=${site.id} branch=${branch}`, e);
    const error = syncErrorDetail(e);
    await resolveDeployment(deploymentId, {
      siteId: site.id,
      ok: false,
      commitMessage: message,
      error,
      durationMs: Date.now() - startedAt,
    });
    // Session intentionally left open: the drafts are the source of truth and a retry is
    // safe (every write is an idempotent overwrite).
    return { ok: false, error };
  }
}
