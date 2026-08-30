import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { site as siteTable, deployment } from "./db/app-schema";
import { revalidateSiteRow } from "./tenant";
import { triggerActivity } from "./realtime";
import { fireContentUpdateAutomations } from "./automations/runs";

/**
 * Deployment-row bookkeeping, shared by every path that puts content live (SPEC §10.3):
 * the repo sync (`sync-runner.ts`), the connect flow (`actions/sites.ts`), and the
 * Papervine-hosted publish + create (`native-publish.ts`, `createBlankSite`).
 *
 * Extracted deliberately narrow — just the three pieces that were copy-pasted and are easy
 * to get subtly wrong — rather than a generic "run a deployment" wrapper: `runSync`
 * interleaves commit-specific fields that don't generalize, and threading a callback
 * through it would couple more than it saves.
 */

/**
 * What put content live. `'connect' | 'manual' | 'webhook'` are syncs (see `SyncTrigger`);
 * `'publish'` is an editor publish on a Papervine-hosted site and `'create'` is the seeding
 * of a new one. Mirrored in the `deployment.trigger` column comment, and rendered by
 * `triggerLabel`/`triggerDetail` in overview.ts.
 */
export type DeploymentTrigger = "connect" | "manual" | "webhook" | "publish" | "create";

/**
 * Record a 'building' deployment row BEFORE any slow or fallible work, and nudge the
 * Activity feed. This is the durable log: if the caller throws, `resolveDeployment` flips
 * the row to failed with the reason; if the function is *killed* (a serverless timeout — no
 * catch can run) the row simply STAYS 'building', which the feed shows as a stuck sync —
 * a visible signal instead of silence. Every attempt leaves a trace.
 *
 * `notify: false` skips the realtime ping for a caller whose very next action renders the
 * feed anyway (the connect flow), so we don't publish an event nobody is listening for yet.
 */
export async function openDeployment(input: {
  siteId: string;
  trigger: DeploymentTrigger;
  commitMessage: string;
  actorUserId?: string | null;
  target?: "live" | "preview";
  notify?: boolean;
}): Promise<string> {
  const id = randomUUID();
  await db.insert(deployment).values({
    id,
    siteId: input.siteId,
    status: "building",
    target: input.target ?? "live",
    commitMessage: input.commitMessage,
    trigger: input.trigger,
    actorUserId: input.actorUserId ?? null,
  });
  // Best-effort: unconfigured or failing realtime no-ops (the row is already durable).
  if (input.notify !== false) await triggerActivity(input.siteId);
  return id;
}

/**
 * Resolve a 'building' row to its outcome and ping the feed again, so the building pill
 * flips to Successful/Failed without waiting for a poll. `durationMs` is recorded because
 * a run that lands near the function time limit is itself diagnostic.
 */
export async function resolveDeployment(
  deploymentId: string,
  input: {
    siteId: string;
    ok: boolean;
    commitMessage: string;
    commitSha?: string | null;
    error?: string | null;
    filesAdded?: number;
    filesEdited?: number;
    durationMs: number;
  },
): Promise<void> {
  await db
    .update(deployment)
    .set({
      status: input.ok ? "successful" : "failed",
      commitSha: input.commitSha ?? null,
      commitMessage: input.commitMessage,
      error: input.error ?? null,
      filesAdded: input.filesAdded ?? 0,
      filesEdited: input.filesEdited ?? 0,
      durationMs: input.durationMs,
    })
    .where(eq(deployment.id, deploymentId));
  await triggerActivity(input.siteId);
}

/**
 * Promote a site to live after its content actually landed in object storage, and make
 * readers see it.
 *
 * THE `updatedAt` bump lives here and nowhere else, because it is load-bearing: the render
 * path's content-cache version key is `${lastSyncedCommitSha ?? ""}:${updatedAt}` (see
 * request-source.ts), so without the bump a re-sync of the same commit — or ANY publish on
 * a Papervine-hosted site, whose sha is null forever, making updatedAt the entire key —
 * keeps serving the pre-publish copy indefinitely.
 *
 * Revalidation is best-effort and must not fail a publish whose bytes are already written:
 * `revalidateTag` needs a Next request context, and this is reachable from a Trigger.dev
 * task (automation-run.ts) and from `after()`, neither of which has one (see tenant.ts).
 * The `updatedAt` write above is the invalidation that always works; the tags just make it
 * immediate instead of TTL-bounded.
 */
export async function markSiteLive(
  site: { id: string; slug: string; customDomain: string | null },
  opts: {
    /** Synced head sha; null for a Papervine-hosted publish, which has no commit. */
    commitSha?: string | null;
    /**
     * Fan out to the site's enabled content_update automations. Pass `false` from an
     * automation's OWN publish: the fan-out dedupes on `automationRef`, and a hosted
     * publish has no commit sha to dedupe on, so an automation that publishes would
     * otherwise re-trigger itself (bounded only by the daily run cap).
     */
    fireAutomations?: boolean;
    /**
     * Idempotency key for the fan-out when there's no commit sha (a Papervine-hosted
     * publish, a commit-less manual re-sync). Must be STABLE for this deployment — the
     * deployment id — never a fresh random value, which defeats the self-trigger loop
     * breaker. `commitSha` always wins when present: it's what makes an automation's own
     * commit dedupe against the run row that produced it.
     */
    fallbackRef?: string | null;
  } = {},
): Promise<void> {
  await db
    .update(siteTable)
    .set({
      status: "live",
      lastSyncedCommitSha: opts.commitSha ?? null,
      updatedAt: new Date(),
      // Mark the generated skill.md stale (SPEC §9.1) — MARK, not regenerate. A publish is a
      // cheap signal that something MIGHT have changed; the sweep fingerprints the site and
      // decides whether it actually did. Generating here would spend a model call on every typo
      // fix, and would do it on the publish path, where someone is waiting.
      skillStaleAt: new Date(),
    })
    .where(eq(siteTable.id, site.id));

  try {
    revalidateSiteRow({ slug: site.slug, domains: [site.customDomain] });
  } catch (e) {
    console.error(`[deployment] revalidateSiteRow failed site=${site.id}`, e);
  }

  if (opts.fireAutomations !== false) {
    // Never throws; idempotent per ref; no-op when no executor is configured.
    await fireContentUpdateAutomations(site.id, opts.commitSha ?? opts.fallbackRef ?? null);
  }
}
