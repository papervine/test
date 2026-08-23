import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "./db";
import { site as siteTable, deployment } from "./db/app-schema";
import { findOpenSession, listDraftFiles, closeSession } from "./draft-store";
import { putObject, deleteKeys, listKeys } from "./storage";
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
 * **Guarantee: at-least-once and retry-safe, not atomic.** There is no transaction across N
 * object writes, so we (a) write pages before `docs.json` before deletes, so a partial
 * publish never leaves navigation pointing at pages that aren't there, and (b) leave the
 * session OPEN on failure, so the drafts survive and re-publishing is idempotent. The worst
 * observable outcome is a page still serving its previous content — never a 500. True
 * atomicity needs a content-addressed prefix plus a pointer flip, which would also fix the
 * long-standing concurrent-sync race; noted in SPEC, not built here.
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
  // already use rather than inventing a second one: two publishes interleaving over the
  // same storage prefix can leave a reader a torn tree. A `building` row older than the
  // window is an orphaned killed run and must not block publishing forever.
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
    // One list call to classify added-vs-modified for the feed, rather than a getObjectText
    // per file the way listSessionChanges does.
    const existingKeys = new Set(await listKeys(`sites/${site.id}/`));
    const plan = planNativePublish(site.id, drafts, existingKeys);

    // Phase 1: pages and assets. Phase 2: the config, so nav never precedes its pages.
    // Phase 3: removals, which the new config has already stopped referencing — so a crash
    // between phases leaves orphaned objects (invisible to the renderer) rather than
    // sidebar entries that 404.
    await Promise.all(plan.puts.map((w) => putObject(w.key, w.content, w.contentType)));
    for (const w of plan.configPuts) await putObject(w.key, w.content, w.contentType);
    if (plan.deletes.length) await deleteKeys(plan.deletes);

    // Serve the new bytes immediately instead of the pre-publish copy.
    revalidateSite(site.id);
    await closeSession(session.id, "published");
    // Promotes to live and bumps updatedAt — which for a hosted site is the ENTIRE content
    // cache version key (its commit sha is null forever), so this is what makes the publish
    // visible at all. The deployment id is the automation dedupe ref: stable across a retry
    // of this publish, unlike the random fallback that would let an automation re-fire.
    await markSiteLive(site, {
      fireAutomations: opts.origin !== "automation",
      fallbackRef: deploymentId,
    });
    await resolveDeployment(deploymentId, {
      siteId: site.id,
      ok: true,
      commitMessage: message,
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
