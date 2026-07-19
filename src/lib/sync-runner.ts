import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { site as siteTable, deployment } from "./db/app-schema";
import { syncSite, type SyncResult } from "./sync";
import { fetchLatestCommit, type CommitInfo } from "./github";
import { repoTokenForSite } from "./github-token";
import { revalidateSite } from "./s3-source";
import { revalidateSiteRow } from "./tenant";
import { syncErrorDetail } from "./sync-error";
import { triggerActivity } from "./realtime";
import { fireContentUpdateAutomations } from "./automations/runs";

type SiteRow = typeof siteTable.$inferSelect;

// What kicked off this sync — drives the Activity-feed framing and nothing else.
// 'connect' = first sync at repo-connect; 'manual' = the Re-sync button; 'webhook' = a
// GitHub push (SPEC §3, the C-full auto-sync).
export type SyncTrigger = "connect" | "manual" | "webhook";

export type RunSyncOptions = {
  // Who to credit on the deployment row. The webhook has no session → null (the column
  // is nullable; the feed shows it as a system/GitHub sync).
  actorUserId?: string | null;
  trigger: SyncTrigger;
  // The head commit for this sync. The push webhook carries it in its payload; connect
  // already fetched it. When omitted (manual re-sync) the runner fetches the latest so
  // commitSha / lastSyncedCommitSha stay accurate.
  commit?: CommitInfo | null;
  // An already-inserted 'building' deployment row to resolve, instead of creating one. The
  // connect flow pre-creates it so it can return immediately and run the (slow) sync in
  // `after()` — the user lands on the site page and the row is already there to show/poll.
  deploymentId?: string;
};

export type RunSyncOutcome = {
  result: SyncResult | null;
  error: string | null;
  // The synced head sha, if known — lets a caller (the webhook) record idempotency.
  commitSha: string | null;
};

// The framing differs only in wording + which file counter the feed reads. Connect is
// an "add" (every file is new); manual/webhook are "edits" (a re-pull). Kept identical
// to the strings the dashboard has always shown so the feed doesn't visibly change.
function deploymentMessage(
  trigger: SyncTrigger,
  commit: CommitInfo | null | undefined,
  result: SyncResult | null,
): string {
  if (commit?.message) return commit.message;
  if (trigger === "connect") return "Connected repository";
  return result ? `Re-synced ${result.files} files` : "Re-sync failed";
}

/**
 * Run one sync of a site's repo into object storage and record the deployment — the
 * shared core behind the connect flow, the manual Re-sync button, and the push webhook
 * (SPEC §3). Session-less by design: authorization is the caller's job (a logged-in
 * action, or a verified webhook signature), so this never calls getSession().
 *
 * A failed sync is recorded as a failed deployment (with the captured reason) and never
 * throws — the connection survives and the user can re-sync. On success it promotes the
 * site to 'live' and stamps lastSyncedCommitSha for webhook idempotency.
 */
export async function runSync(
  site: SiteRow,
  opts: RunSyncOptions,
): Promise<RunSyncOutcome> {
  const { trigger, actorUserId = null } = opts;
  const startedAt = Date.now();

  // Record a 'building' deployment row UP FRONT, before any slow/fallible work. This is
  // the durable log: if the whole thing throws (e.g. a bad App private key) the catch
  // below flips it to 'failed' with the reason; if the function is *killed* mid-sync (a
  // serverless timeout — no catch can run), the row simply STAYS 'building', which the
  // Activity feed shows as a stuck/in-progress sync — a visible signal instead of the old
  // silent nothing. Every attempt leaves a trace.
  // When the caller pre-created the building row (connectRepo, so the user can be redirected
  // immediately while this runs in after()), reuse it; otherwise insert one now.
  const deploymentId = opts.deploymentId ?? randomUUID();
  if (!opts.deploymentId) {
    await db.insert(deployment).values({
      id: deploymentId,
      siteId: site.id,
      status: "building",
      target: "live",
      commitMessage: trigger === "connect" ? "Connecting repository…" : "Syncing…",
      trigger,
      actorUserId,
    });
    // Nudge any open Activity feed to show the building row now, not on its next poll.
    // Best-effort: unconfigured/failed realtime no-ops (the row is already durable in the DB).
    await triggerActivity(site.id);
  }

  let result: SyncResult | null = null;
  let error: string | null = null;
  let commit = opts.commit ?? null;
  try {
    const token = await repoTokenForSite(site);
    // Caller-provided commit (push payload) or look up the head so the recorded sha is real.
    if (!commit) {
      commit = await fetchLatestCommit(site.repoOwner!, site.repoName!, site.branch, token);
    }
    result = await syncSite({
      id: site.id,
      repoOwner: site.repoOwner!,
      repoName: site.repoName!,
      branch: site.branch,
      token,
      isPrivate: site.isPrivate,
      docsPath: site.docsPath,
    });
    revalidateSite(site.id); // serve fresh content immediately, not the pre-sync copy
  } catch (e) {
    // Tagged + structured so it's greppable in the platform's runtime logs (`vercel logs`)
    // as well as recorded on the row below.
    console.error(
      `[sync] failed trigger=${trigger} site=${site.id} repo=${site.repoOwner}/${site.repoName}@${site.branch}`,
      e,
    );
    error = syncErrorDetail(e);
  }

  // Resolve the building row to its outcome. Includes how long it took, since a sync that
  // genuinely runs near the function time limit is itself diagnostic.
  const isConnect = trigger === "connect";
  await db
    .update(deployment)
    .set({
      status: result ? "successful" : "failed",
      commitSha: commit?.sha ?? null,
      commitMessage: deploymentMessage(trigger, commit, result),
      error,
      filesAdded: isConnect ? (result?.files ?? 0) : 0,
      // Re-syncs now record what actually changed (the diff), not the whole file count —
      // incremental sync only moves changed/new blobs (src/lib/sync.ts).
      filesEdited: isConnect ? 0 : (result?.uploaded ?? 0),
      durationMs: Date.now() - startedAt,
    })
    .where(eq(deployment.id, deploymentId));
  console.log(
    `[sync] done trigger=${trigger} site=${site.id} status=${result ? "successful" : "failed"} files=${result?.files ?? 0} ms=${Date.now() - startedAt}`,
  );
  // Second ping: the building pill flips to Successful/Failed in the feed without a poll.
  await triggerActivity(site.id);

  // On success: promote to live (the schema's "draft until first successful sync") and
  // stamp the synced head so a redelivered/duplicate push webhook can no-op.
  if (result) {
    // Bump updatedAt on every success — the render's content-cache key folds it in (see
    // request-source.ts), so a re-sync of the SAME commit still produces a fresh key and
    // serves the new content instead of the pre-sync copy.
    await db
      .update(siteTable)
      .set({
        status: "live",
        lastSyncedCommitSha: commit?.sha ?? null,
        updatedAt: new Date(),
      })
      .where(eq(siteTable.id, site.id));
    // Drop the cached site row so the new sha/updatedAt (the content-cache version key) is read
    // fresh. Immediate for a manual sync (server-action context); a no-op for the push webhook,
    // whose runSync is in after() — there the SITE_ROW_TTL backstop applies (see tenant.ts).
    revalidateSiteRow({ slug: site.slug, domains: [site.customDomain] });
    // Content just went live → fan out to the site's enabled content_update automations
    // (SPEC §10.2). Never throws; idempotent per commit sha, which is also what stops an
    // automation's own commit from re-firing itself; no-op when no executor is configured.
    await fireContentUpdateAutomations(site.id, commit?.sha ?? null);
  }

  return { result, error, commitSha: commit?.sha ?? null };
}
