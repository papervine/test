/**
 * The default publish action for the editor's currently-selected branch (SPEC §9.2/§10).
 * Mirrors the incumbent: on the deploy ("Default") branch, Publish commits straight to it; on a
 * working branch, Publish opens a PR into the deploy branch. The editor opens on the deploy
 * branch by default, so the common case is a direct commit. The caret menu still offers both
 * modes explicitly — this only picks the primary button's action.
 */
export function publishModeForBranch(branch: string, deployBranch: string): "commit" | "pr" {
  return branch === deployBranch ? "commit" : "pr";
}
