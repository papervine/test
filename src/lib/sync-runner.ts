import "server-only";
import { site as siteTable } from "./db/app-schema";
import { syncSite, type SyncResult } from "./sync";
import { fetchLatestCommit, type CommitInfo } from "./github";
import { repoTokenForSite } from "./github-token";
import { revalidateSite } from "./s3-source";
import { syncErrorDetail } from "./sync-error";
import { openDeployment, resolveDeployment, markSiteLive } from "./deployment-log";
import { liveContentPrefix } from "./revisions";
import { pruneSiteRevisions } from "./revision-store";

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
  const deploymentId =
    opts.deploymentId ??
    (await openDeployment({
      siteId: site.id,
      trigger,
      commitMessage: trigger === "connect" ? "Connecting repository…" : "Syncing…",
      actorUserId,
    }));

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
      // Build a NEW revision named for this deployment, carrying forward from whatever is
      // live now. Nothing readers can see changes until markSiteLive flips the pointer below.
      revisionId: deploymentId,
      fromPrefix: liveContentPrefix(site),
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
  await resolveDeployment(deploymentId, {
    siteId: site.id,
    ok: Boolean(result),
    commitSha: commit?.sha ?? null,
    commitMessage: deploymentMessage(trigger, commit, result),
    // Only on success: a failed sync wrote a partial revision that was never pointed at, and
    // advertising it would offer a Roll back to a tree we deliberately never published.
    revisionId: result ? deploymentId : null,
    error,
    filesAdded: isConnect ? (result?.files ?? 0) : 0,
    // Re-syncs now record what actually changed (the diff), not the whole file count —
    // incremental sync only moves changed/new blobs (src/lib/sync.ts).
    filesEdited: isConnect ? 0 : (result?.uploaded ?? 0),
    durationMs: Date.now() - startedAt,
  });
  console.log(
    `[sync] done trigger=${trigger} site=${site.id} status=${result ? "successful" : "failed"} files=${result?.files ?? 0} ms=${Date.now() - startedAt}`,
  );

  // On success: promote to live (the schema's "draft until first successful sync") and
  // stamp the synced head so a redelivered/duplicate push webhook can no-op.
  // Promotes to live, bumps updatedAt (the content-cache version key — see
  // deployment-log.ts), drops the cached site row, and fans out to content_update
  // automations keyed on the commit sha (SPEC §10.2), which is also what stops an
  // automation's own commit from re-firing itself.
  if (result) {
    // A commit-less sync (a manual re-pull) falls back to the deployment id as the
    // dedupe ref — stable if this same run is retried, unlike the old random fallback.
    // The revision id is that same deployment id: this is the atomic moment the freshly
    // written tree becomes the live one.
    await markSiteLive(site, {
      commitSha: commit?.sha ?? null,
      revisionId: deploymentId,
      fallbackRef: deploymentId,
    });
    await pruneSiteRevisions(site.id, deploymentId);
  }

  return { result, error, commitSha: commit?.sha ?? null };
}
