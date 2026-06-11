import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { site as siteTable, deployment } from "./db/app-schema";
import { syncSite, type SyncResult } from "./sync";
import { fetchLatestCommit, type CommitInfo } from "./github";
import { repoTokenForSite } from "./github-token";
import { revalidateSite } from "./s3-source";
import { syncErrorDetail } from "./sync-error";

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
  const token = await repoTokenForSite(site);

  // Use the caller-provided commit (push payload / connect) or look up the head so the
  // recorded sha is real. A failed lookup is non-fatal — we just record an unknown sha.
  const commit =
    opts.commit ??
    (await fetchLatestCommit(site.repoOwner!, site.repoName!, site.branch, token));

  let result: SyncResult | null = null;
  let error: string | null = null;
  try {
    result = await syncSite({
      id: site.id,
      repoOwner: site.repoOwner!,
      repoName: site.repoName!,
      branch: site.branch,
      token,
      docsPath: site.docsPath,
    });
    revalidateSite(site.id); // serve fresh content immediately, not the pre-sync copy
  } catch (e) {
    console.error(`sync failed (${trigger}) for site ${site.id}`, e);
    error = syncErrorDetail(e);
  }

  const isConnect = trigger === "connect";
  await db.insert(deployment).values({
    id: randomUUID(),
    siteId: site.id,
    status: result ? "successful" : "failed",
    target: "live",
    commitSha: commit?.sha ?? null,
    commitMessage: deploymentMessage(trigger, commit, result),
    error,
    filesAdded: isConnect ? (result?.files ?? 0) : 0,
    filesEdited: isConnect ? 0 : (result?.files ?? 0),
    actorUserId,
  });

  // On success: promote to live (the schema's "draft until first successful sync") and
  // stamp the synced head so a redelivered/duplicate push webhook can no-op.
  if (result) {
    await db
      .update(siteTable)
      .set({ status: "live", lastSyncedCommitSha: commit?.sha ?? null })
      .where(eq(siteTable.id, site.id));
  }

  return { result, error, commitSha: commit?.sha ?? null };
}
