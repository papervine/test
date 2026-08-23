/**
 * The publish vocabulary — what "Publish" means for a given site and branch, and what a
 * finished publish is identified by. Pure and DB-free (it takes a boolean, never a site
 * row), so both publishers and the editor UI can share it with no import cycle:
 * `authoring-core.ts` (Git) and `native-publish.ts` (Papervine-hosted) both produce a
 * `PublishResult` defined here.
 */

/**
 * How a session's buffered edits reached the live site.
 *  - 'commit' — committed straight onto a Git site's deploy branch.
 *  - 'pr'     — pushed to a working branch with a PR opened into the deploy branch.
 *  - 'native' — written straight to object storage on a Papervine-hosted site. There's no
 *               commit or PR, so there's no external reference to hand back — the
 *               deployment row is the record (SPEC §10.11).
 */
export type PublishResult =
  | { ok: true; mode: "commit"; commitSha: string }
  | { ok: true; mode: "pr"; prUrl: string; prNumber: number }
  | { ok: true; mode: "native"; files: number; deploymentId: string }
  | { ok: false; conflict?: true; error: string };

/** The publish action a given branch on a given kind of site performs. */
export type PublishMode = "commit" | "pr" | "native";

/**
 * The default publish action for the editor's currently-selected branch (SPEC §9.2/§10).
 * On a Git site this mirrors hosted docs platforms: on the deploy ("Default") branch,
 * Publish commits straight to it; on a working branch, Publish opens a PR into the deploy
 * branch. The editor opens on the deploy branch by default, so the common case is a direct
 * commit.
 *
 * A Papervine-hosted site has no repo and therefore no PR target — every publish writes
 * straight to the live site, on any branch. (Working branches still exist there; they're
 * just draft namespaces in Postgres.)
 */
export function publishModeFor(input: {
  gitBacked: boolean;
  branch: string;
  deployBranch: string;
}): PublishMode {
  if (!input.gitBacked) return "native";
  return input.branch === input.deployBranch ? "commit" : "pr";
}

/**
 * The explicit publish actions the editor's caret menu should offer, beyond the primary
 * button. Empty on a Papervine-hosted site: "Open a pull request" and "Commit to the deploy
 * branch" are Git mechanics, and offering them would fail at the server dispatch.
 */
export function publishMenuModes(gitBacked: boolean): PublishMode[] {
  return gitBacked ? ["pr", "commit"] : [];
}

/**
 * The external identifier to record for a successful publish — a commit sha, a PR URL, or
 * null for a hosted publish, which has neither. Used by the automation runs' `resultRef`,
 * and the reason a third `PublishResult` arm doesn't need `?? ""` sprinkled at call sites.
 */
export function publishResultRef(result: Extract<PublishResult, { ok: true }>): string | null {
  if (result.mode === "commit") return result.commitSha;
  if (result.mode === "pr") return result.prUrl;
  return null;
}
