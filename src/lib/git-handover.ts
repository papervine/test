import "server-only";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { site } from "./db/app-schema";
import type { SiteRow } from "./dashboard-context";
import {
  fetchRepo,
  getRef,
  listRepoTree,
  commitFiles,
  createBranch,
  updateRef,
  hasDocsConfig,
  type FileChange,
} from "./github";
import { listKeys, getObjectText } from "./storage";
import { repoEmptiness, planConversion } from "./git-conversion";
import { runSync } from "./sync-runner";
import { isNativeSite } from "./site-source";

/**
 * Which content wins when the target repo ISN'T empty (SPEC §10.11).
 *  - 'local' — the Papervine-hosted content is authoritative: it's committed over the repo's,
 *    whose version survives in git history.
 *  - 'repo'  — the repository is authoritative: the site adopts it. The hosted content is
 *    committed to a backup branch FIRST, because unlike the repo's files it has no history to
 *    fall back on once the sync overwrites storage.
 */
export type HandoverResolution = "local" | "repo";

/** Where the hosted content is parked when the repository wins. */
const BACKUP_BRANCH = "papervine/hosted-content";

export type HandoverResult =
  | { ok: true; branch: string; backedUpTo?: string }
  | { ok: false; error: string; needsResolution?: true };

/**
 * The hosted → Git hand-over (SPEC §10.11): move a Papervine-hosted site's content into a
 * repository, then flip it to Git-backed and let the normal sync pull it back.
 *
 * Shared by both entry points — the manual "I picked a repo" action and the one-click flow
 * that creates the repo first — so the risky part lives here once.
 *
 * An EMPTY repo needs no decision. A non-empty one does, and this never guesses: without a
 * `resolution` it refuses with `needsResolution` so the caller can ask. That's the whole
 * reason the decision is surfaced rather than a blanket "empty repos only" — a repo with
 * existing docs is a legitimate target, it just isn't ours to silently overwrite.
 *
 * Ordering is chosen so every failure is recoverable: commit → flip the row → sync. A crash
 * after the commit leaves a repo holding the content and a still-hosted site (re-runnable);
 * after the flip, a Git site whose repo already has everything (a Re-sync finishes it).
 */
export async function handOverToGit(
  s: SiteRow,
  input: {
    owner: string;
    name: string;
    branch?: string;
    docsPath?: string;
    /** Token with WRITE access to the target repo — installation or user. */
    token: string;
    actorUserId?: string | null;
    installationId?: number | null;
    resolution?: HandoverResolution;
  },
): Promise<HandoverResult> {
  if (!isNativeSite(s)) return { ok: false, error: "This site is already connected to a repository." };

  const { owner, name, token } = input;
  const docsPath = input.docsPath ?? "";

  const repo = await fetchRepo(owner, name, token);
  if (!repo) {
    return {
      ok: false,
      error: `Can't read ${owner}/${name} — check the name and that Papervine has access to it.`,
    };
  }
  const branch = input.branch?.trim() || repo.defaultBranch;

  // No head means a repo with no commits at all — the emptiest case, which takes the
  // parentless initial-commit path below.
  const base = await getRef(owner, name, branch, token);
  const tree = base ? await listRepoTree(owner, name, branch, token) : null;
  const emptiness = repoEmptiness(tree);

  // A non-empty repo is a decision, not an error — but it's the owner's to make.
  if (!emptiness.empty && !input.resolution) {
    return { ok: false, error: emptiness.reason, needsResolution: true };
  }
  // An empty repo has nothing to lose, so it always takes the "our content" path.
  const resolution: HandoverResolution = emptiness.empty ? "local" : input.resolution!;

  // Adopting the repository only works if it actually carries a docs config: without one the
  // synced site has no docs.json, and the render path THROWS rather than degrading. Refuse
  // up front instead of flipping the site into a permanently 500ing state.
  if (resolution === "repo" && !(await hasDocsConfig(owner, name, branch, token, docsPath))) {
    const where = docsPath ? `in ${docsPath}/ of` : "at the root of";
    return {
      ok: false,
      error:
        `There's no docs.json or mint.json ${where} ${owner}/${name}@${branch}, so the ` +
        `repository can't be the source of truth. Keep your Papervine content instead, or add a config to the repo.`,
    };
  }

  // The site's live content, straight out of storage.
  const keys = await listKeys(`sites/${s.id}/`);
  const plan = planConversion(s.id, keys, docsPath);
  if (plan.length === 0) {
    return { ok: false, error: "This site has no published content yet — publish a page in Studio first." };
  }
  const files: FileChange[] = [];
  for (const file of plan) {
    const content = await getObjectText(file.storageKey);
    // Skip rather than abort: a key that vanished mid-read is a torn publish, and the rest
    // is still a coherent site.
    if (content !== null) files.push({ path: file.repoPath, content });
  }
  if (files.length === 0) return { ok: false, error: "Couldn't read this site's content. Try again." };

  // Where the hosted content gets committed. Winning → onto the deploy branch, over the
  // repo's files (theirs stay in history). Losing → onto a backup branch, so it's still
  // recoverable after the sync overwrites storage with the repo's version.
  const target = resolution === "local" ? branch : BACKUP_BRANCH;
  let backedUpTo: string | undefined;

  if (resolution === "local") {
    const commit = await commitFiles(owner, name, {
      baseCommitSha: base?.commitSha ?? null,
      baseTreeSha: base?.treeSha ?? null,
      files,
      message: `docs: move ${s.name} from Papervine to Git`,
      token,
    });
    if ("error" in commit) return { ok: false, error: commit.error };
    // An existing branch moves; a repo with no commits needs its ref created instead.
    const landed = base
      ? await updateRef(owner, name, branch, commit.commitSha, token)
      : await createBranch(owner, name, branch, commit.commitSha, token);
    if (!landed.ok) return { ok: false, error: landed.error ?? "Failed to push the content." };
  } else {
    // Park the hosted content on its own branch before the repo takes over. `base` exists
    // here by construction: a repo with no commits is empty, which never reaches this path.
    const created = await createBranch(owner, name, target, base!.commitSha, token);
    if (!created.ok) return { ok: false, error: created.error ?? "Failed to create the backup branch." };
    // Re-running lands on top of the existing branch rather than forking a sibling commit
    // (the same non-fast-forward trap publishDraft documents).
    const tip = created.alreadyExists ? await getRef(owner, name, target, token) : base!;
    if (!tip) return { ok: false, error: `Can't read the ${target} branch to back up onto.` };
    const commit = await commitFiles(owner, name, {
      baseCommitSha: tip.commitSha,
      baseTreeSha: tip.treeSha,
      files,
      message: `docs: ${s.name}'s Papervine content, kept before adopting this repo`,
      token,
    });
    if ("error" in commit) return { ok: false, error: commit.error };
    const landed = await updateRef(owner, name, target, commit.commitSha, token);
    if (!landed.ok) return { ok: false, error: landed.error ?? "Failed to push the backup branch." };
    backedUpTo = target;
  }

  const [updated] = await db
    .update(site)
    .set({
      sourceKind: "git",
      repoOwner: owner,
      repoName: name,
      branch,
      docsPath,
      githubInstallationId: input.installationId ?? null,
      updatedAt: new Date(),
    })
    .where(eq(site.id, s.id))
    .returning();

  try {
    // Pulls the deploy branch into storage. When the repo won, this is what replaces the
    // hosted content — which is exactly why it was backed up above first.
    await runSync(updated, { actorUserId: input.actorUserId ?? null, trigger: "manual" });
  } catch (e) {
    // The content is already in git and the row already flipped — a failed first sync is a
    // Re-sync away, and must not read as "the hand-over failed".
    console.error(`[git-handover] runSync threw for site ${s.id}`, e);
  }

  return { ok: true, branch, ...(backedUpTo ? { backedUpTo } : {}) };
}
