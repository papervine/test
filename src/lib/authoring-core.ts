import "server-only";
import { randomUUID } from "node:crypto";
import type { SiteRow } from "./dashboard-context";
import { repoTokenForSite } from "./github-token";
import { isGithubAppConfigured } from "./github-app";
import { getRef, commitFiles, createBranch, updateRef, openPullRequest, type FileChange } from "./github";
import {
  findOpenSession,
  getDraftFile,
  listOpenSessions,
  createSession,
  closeSession,
  upsertDraftFile,
  listDraftFiles,
  deleteDraftFile,
  type EditorSessionRow,
} from "./draft-store";
import { getObjectText, getObjectBytes, headObject, deleteKeys } from "./storage";
import { draftAssetKey } from "./media-upload";
import { runSync } from "./sync-runner";
import { isNativeSite } from "./site-source";
import { publishNative } from "./native-publish";
import type { PublishResult } from "./publish-mode";
import { recordPageVersions } from "./page-history-store";
import { liveContentPrefix } from "./revisions";

const PAGE_EXTS = [".mdx", ".md"];

// THE shared authoring backend (SPEC §9.2). One module behind both the web editor
// (server actions) and the editing agent / authoring MCP (AI SDK tools), so a human and
// an agent edit the SAME draft buffer. Each function takes a resolved SiteRow — auth
// happens at the edge (findSite/requireSite), never here.

/** A working branch name for a fresh edit session, e.g. "papervine/edit-1a2b3c4d". */
export function editBranchName(): string {
  return `papervine/edit-${randomUUID().slice(0, 8)}`;
}

/** docs-root-relative draft path → repo path (re-adds the site's docsPath prefix). */
function repoPath(site: SiteRow, path: string): string {
  return site.docsPath ? `${site.docsPath}/${path}` : path;
}

// Defined in publish-mode.ts (pure) so the hosted publisher can produce one too without an
// import cycle. Re-exported here because this module is the authoring layer's front door.
export type { PublishResult };

/**
 * Open (or attach to) an edit session. With `branchName` it re-attaches to an existing
 * open session for that branch (or records a new session row pointing at it); otherwise
 * it mints a fresh working branch. The remote git branch is created lazily at publish —
 * drafts live in Postgres until then — so checkout never touches GitHub.
 */
export async function checkoutBranch(
  site: SiteRow,
  opts: { actorUserId?: string | null; branchName?: string } = {},
): Promise<{ branch: string; sessionId: string }> {
  const branch = opts.branchName ?? editBranchName();
  const existing = await findOpenSession(site.id, branch);
  if (existing) return { branch, sessionId: existing.id };

  // Record the deploy-branch head at checkout for the publish-time divergence check.
  // Best-effort: a token-less/unreadable repo leaves baseCommitSha null (publish skips
  // the optimistic check and relies on updateRef(force:false)). A Papervine-hosted site has
  // no repo to read a head from — and nothing to diverge from, since its publish writes
  // storage directly — so skip GitHub entirely rather than calling it with a null owner.
  const base = isNativeSite(site)
    ? null
    : await getRef(site.repoOwner!, site.repoName!, site.branch, await repoTokenForSite(site));
  const session = await createSession({
    siteId: site.id,
    branch,
    baseBranch: site.branch,
    baseCommitSha: base?.commitSha ?? null,
    createdBy: opts.actorUserId ?? null,
  });
  return { branch, sessionId: session.id };
}

/**
 * Resolve a page slug to its docs-root-relative file path + current raw text (draft if
 * the session has touched it, else the synced S3 copy). Preserves the existing extension
 * (.mdx/.md); a brand-new page defaults to .mdx. `raw` is null for a new or deleted page.
 * Used by the editing agent's write/edit tools so a targeted edit operates on real content.
 */
export async function resolvePagePath(
  site: SiteRow,
  branch: string,
  slug: string,
): Promise<{ path: string; raw: string | null }> {
  const clean = slug.replace(/^\//, "");
  const normalized = clean === "" || clean === "/" ? "index" : clean;
  const session = await findOpenSession(site.id, branch);
  for (const ext of PAGE_EXTS) {
    const path = `${normalized}${ext}`;
    if (session) {
      const draft = await getDraftFile(session.id, path);
      if (draft) return { path, raw: draft.deleted ? null : draft.content };
    }
    const raw = await getObjectText(`${liveContentPrefix(site)}${path}`);
    if (raw !== null) return { path, raw };
  }
  return { path: `${normalized}.mdx`, raw: null };
}

/** The published (base) MDX for a page — S3 synced content only, ignoring any draft. Used by
 *  the editor's diff view to compare the working draft against what's live. */
export async function resolveBasePage(site: SiteRow, slug: string): Promise<{ path: string; raw: string | null }> {
  const clean = slug.replace(/^\//, "");
  const normalized = clean === "" || clean === "/" ? "index" : clean;
  for (const ext of PAGE_EXTS) {
    const path = `${normalized}${ext}`;
    const raw = await getObjectText(`${liveContentPrefix(site)}${path}`);
    if (raw !== null) return { path, raw };
  }
  return { path: `${normalized}.mdx`, raw: null };
}

/** Read one file's current draft-aware text by exact repo path (draft overlay, else S3). Used
 *  for non-page files like `docs.json`. Returns null if deleted in the draft or missing. */
export async function resolveDraftFile(site: SiteRow, branch: string, path: string): Promise<string | null> {
  const session = await findOpenSession(site.id, branch);
  if (session) {
    const draft = await getDraftFile(session.id, path);
    if (draft) return draft.deleted ? null : draft.content;
  }
  return getObjectText(`${liveContentPrefix(site)}${path}`);
}

/** Buffer an edit to one file (auto-checks-out the branch if no session is open yet). */
export async function saveDraft(
  site: SiteRow,
  branch: string,
  path: string,
  content: string,
  opts: { deleted?: boolean; actorUserId?: string | null } = {},
): Promise<{ ok: true }> {
  let session = await findOpenSession(site.id, branch);
  if (!session) {
    const { sessionId } = await checkoutBranch(site, { branchName: branch, actorUserId: opts.actorUserId });
    session = (await findOpenSession(site.id, branch)) ?? { id: sessionId } as EditorSessionRow;
  }
  await upsertDraftFile({ sessionId: session.id, path, content, deleted: opts.deleted ?? false });
  return { ok: true };
}

/** Open edit sessions for a site — the branch switcher's working-branch list. */
export async function listSessions(site: SiteRow): Promise<EditorSessionRow[]> {
  return listOpenSessions(site.id);
}

/**
 * Discard a session — a soft close (status → 'discarded'), not a delete: its draftFile rows
 * stay in Postgres, just unreachable via findOpenSession (which only matches 'open'). They're
 * only physically removed if the site itself is deleted later (a real FK cascade, on that
 * table only). Cheap to leave around; if that ever needs cleaning up, do it here explicitly —
 * don't assume a status flip already did it.
 */
export async function discardSession(site: SiteRow, branch: string): Promise<{ ok: boolean }> {
  const session = await findOpenSession(site.id, branch);
  if (!session) return { ok: false };
  await closeSession(session.id, "discarded");
  return { ok: true };
}

export type SessionChange = {
  path: string;
  content: string | null;
  status: "added" | "modified" | "deleted";
};

/**
 * Every draft file in the session, classified against the published (S3) content — for the
 * Publish panel's "N file changes" list (SPEC §9.2). Classification is parallelized: each
 * check is an S3 round trip, and a session can have many files.
 */
export async function listSessionChanges(site: SiteRow, branch: string): Promise<SessionChange[]> {
  const session = await findOpenSession(site.id, branch);
  if (!session) return [];
  const drafts = await listDraftFiles(session.id);
  return Promise.all(
    drafts.map(async (d): Promise<SessionChange> => {
      if (d.deleted) return { path: d.path, content: null, status: "deleted" };
      // An uploaded asset is classified by whether the live key EXISTS, not by reading it — the
      // text path would pull a whole video into memory just to decide "added" vs "modified".
      const exists = d.binary
        ? (await headObject(`${liveContentPrefix(site)}${d.path}`)) !== null
        : (await getObjectText(`${liveContentPrefix(site)}${d.path}`)) !== null;
      return { path: d.path, content: d.content, status: exists ? "modified" : "added" };
    }),
  );
}

/** Discard one file's draft — its base content (or absence, for an added file) shows
 *  through again. Correctly reverts an added, modified, OR deleted draft alike. */
export async function revertDraftFile(
  site: SiteRow,
  branch: string,
  path: string,
): Promise<{ ok: boolean }> {
  const session = await findOpenSession(site.id, branch);
  if (!session) return { ok: false };
  // Reverting an uploaded asset drops the bytes too, not just the row — otherwise the object sits
  // in the draft prefix forever, invisible and unreferenced, and a re-upload of the same name
  // would find the path "taken" by something nothing points at.
  const draft = await getDraftFile(session.id, path);
  if (draft?.binary) await deleteKeys([draftAssetKey(session.id, path)]);
  await deleteDraftFile(session.id, path);
  return { ok: true };
}

/**
 * Carry a session's buffered edits to git.
 *  - 'commit': commit straight onto the deploy branch (hosted docs platforms' "commit"). The existing
 *    push webhook then auto-syncs; only when the App isn't configured do we sync inline.
 *  - 'pr': create the working branch, commit there, open a PR into the deploy branch.
 * Optimistic concurrency: if the deploy branch moved since checkout we bail with a
 * conflict; updateRef(force:false) is the hard guard against clobbering it.
 */
export async function publishDraft(
  site: SiteRow,
  branch: string,
  opts: {
    mode: "commit" | "pr";
    message?: string;
    actorUserId?: string | null;
    /** Threaded to the hosted publisher so an automation's own publish can't re-fire it. */
    origin?: "editor" | "automation";
  },
): Promise<PublishResult> {
  // A Papervine-hosted site has no repo to commit to: the draft buffer is the source of
  // truth and publishing writes it straight to object storage. `opts.mode` is meaningless
  // there (no PR target), so it's ignored rather than validated — the server decides what
  // publishing means for this site, whatever the UI proposed.
  if (isNativeSite(site)) {
    return publishNative(site, branch, {
      message: opts.message,
      actorUserId: opts.actorUserId,
      origin: opts.origin,
    });
  }

  const session = await findOpenSession(site.id, branch);
  if (!session) return { ok: false, error: "No open edit session for this branch." };

  const token = await repoTokenForSite(site);
  // A public repo reads token-less, but every WRITE needs credentials — without them the git
  // calls (createTree/…) fail deep with an opaque 401. Surface the real reason up front: this
  // site has no GitHub App installation and no stored token (see repoTokenForSite precedence).
  if (!token) {
    return {
      ok: false,
      error:
        "This site has no write access to its repository. Connect it with the GitHub App to " +
        "publish edits, sync changes back, or accept automation runs.",
    };
  }
  const base = await getRef(site.repoOwner!, site.repoName!, session.baseBranch, token);
  if (!base) return { ok: false, error: `Can't read the ${session.baseBranch} branch (check write access).` };

  if (session.baseCommitSha && base.commitSha !== session.baseCommitSha) {
    return {
      ok: false,
      conflict: true,
      error: `The ${session.baseBranch} branch changed since you started editing. Re-checkout to rebase.`,
    };
  }

  const drafts = await listDraftFiles(session.id);
  if (drafts.length === 0) return { ok: false, error: "No changes to publish." };
  // Uploaded assets have no text content — their bytes are in storage under the session's draft
  // prefix, so they're read back and committed as base64 blobs. Sequential reads: a publish
  // carrying several videos shouldn't hold all of them in memory at once.
  const files: FileChange[] = [];
  for (const d of drafts) {
    const path = repoPath(site, d.path);
    if (d.deleted) {
      files.push({ path, content: null });
      continue;
    }
    if (d.binary) {
      const obj = await getObjectBytes(draftAssetKey(session.id, d.path));
      // Skip rather than commit an empty file: a missing object means the upload never landed,
      // and a zero-byte video in the repo is worse than one that isn't there yet.
      if (!obj) continue;
      files.push({ path, content: null, base64: Buffer.from(obj.body).toString("base64") });
      continue;
    }
    files.push({ path, content: d.content });
  }
  if (files.length === 0) return { ok: false, error: "No changes to publish." };
  const message = opts.message?.trim() || `docs: edits via Papervine editor`;

  if (opts.mode === "commit") {
    const commit = await commitFiles(site.repoOwner!, site.repoName!, {
      baseCommitSha: base.commitSha,
      baseTreeSha: base.treeSha,
      files,
      message,
      token,
    });
    if ("error" in commit) return { ok: false, error: commit.error };
    const moved = await updateRef(site.repoOwner!, site.repoName!, session.baseBranch, commit.commitSha, token);
    if (!moved.ok) return { ok: false, error: moved.error ?? "Failed to update the branch." };
    await closeSession(session.id, "published");
    // One version row per changed page (SPEC §10.11). CONTENT IS NOT STORED for a Git site —
    // the row carries the commit sha and the bytes come back from the repo on demand, because
    // copying page bodies in here would be keeping a second copy of somebody's git history.
    //
    // Only publishes made THROUGH Papervine appear. A commit pushed straight to the repo won't,
    // which is the known limit of recording rather than reading `git log` for the path; a Git
    // user still has GitHub for the complete picture.
    await recordPageVersions({
      siteId: site.id,
      pages: drafts
        .filter((d) => !d.deleted && !d.binary)
        .map((d) => ({ path: d.path, content: d.content })),
      actorUserId: opts.actorUserId ?? null,
      deploymentId: null,
      commitSha: commit.commitSha,
    });
    // The push webhook owns the sync (single sync path, no torn-tree race). Without the
    // App configured there's no webhook, so sync inline.
    if (!isGithubAppConfigured()) {
      await runSync(site, { trigger: "manual", actorUserId: opts.actorUserId ?? null });
    }
    return { ok: true, mode: "commit", commitSha: commit.commitSha };
  }

  // PR mode: create the working branch off the base, commit to it, open the PR.
  const created = await createBranch(site.repoOwner!, site.repoName!, branch, base.commitSha, token);
  if (!created.ok) return { ok: false, error: created.error ?? "Failed to create the branch." };

  // Commit onto the working branch's CURRENT tip, not the deploy head. A fresh branch is at `base`,
  // so this is the same thing — but if the branch already exists (a re-publish, or it carried prior
  // commits), basing on `base` would fork a SIBLING commit off the deploy branch, and the
  // updateRef(force:false) below would (correctly) reject it as "Update is not a fast forward".
  // Reading the branch tip makes each publish stack on top, so re-publishing is idempotent.
  const tip = created.alreadyExists
    ? await getRef(site.repoOwner!, site.repoName!, branch, token)
    : base;
  if (!tip) return { ok: false, error: `Can't read the ${branch} branch to publish onto.` };
  const commit = await commitFiles(site.repoOwner!, site.repoName!, {
    baseCommitSha: tip.commitSha,
    baseTreeSha: tip.treeSha,
    files,
    message,
    token,
  });
  if ("error" in commit) return { ok: false, error: commit.error };
  const moved = await updateRef(site.repoOwner!, site.repoName!, branch, commit.commitSha, token);
  if (!moved.ok) return { ok: false, error: moved.error ?? "Failed to update the branch." };
  const pr = await openPullRequest(site.repoOwner!, site.repoName!, {
    head: branch,
    base: session.baseBranch,
    title: message,
    body: "Edited with the Papervine editor.",
    token,
  });
  if ("error" in pr) return { ok: false, error: pr.error };
  await closeSession(session.id, "published");
  return { ok: true, mode: "pr", prUrl: pr.url, prNumber: pr.number };
}
