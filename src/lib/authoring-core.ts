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
  type EditorSessionRow,
} from "./draft-store";
import { getObjectText } from "./storage";
import { runSync } from "./sync-runner";

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

export type PublishResult =
  | { ok: true; mode: "commit"; commitSha: string }
  | { ok: true; mode: "pr"; prUrl: string; prNumber: number }
  | { ok: false; conflict?: true; error: string };

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
  // the optimistic check and relies on updateRef(force:false)).
  const token = await repoTokenForSite(site);
  const base = await getRef(site.repoOwner!, site.repoName!, site.branch, token);
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
    const raw = await getObjectText(`sites/${site.id}/${path}`);
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
    const raw = await getObjectText(`sites/${site.id}/${path}`);
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
  return getObjectText(`sites/${site.id}/${path}`);
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

/** Discard a session and its drafts (FK cascade drops the draftFiles). */
export async function discardSession(site: SiteRow, branch: string): Promise<{ ok: boolean }> {
  const session = await findOpenSession(site.id, branch);
  if (!session) return { ok: false };
  await closeSession(session.id, "discarded");
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
  opts: { mode: "commit" | "pr"; message?: string; actorUserId?: string | null },
): Promise<PublishResult> {
  const session = await findOpenSession(site.id, branch);
  if (!session) return { ok: false, error: "No open edit session for this branch." };

  const token = await repoTokenForSite(site);
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
  const files: FileChange[] = drafts.map((d) => ({
    path: repoPath(site, d.path),
    content: d.deleted ? null : d.content,
  }));
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
