/**
 * Where a site's content comes FROM — the authoring source of truth (SPEC §10.11).
 *
 * Two kinds:
 *   'git'    — a connected GitHub repo. `syncSite` copies repo → object storage and the
 *              editor publishes by committing (or opening a PR).
 *   'native' — Papervine-hosted: no repo at all. The draft buffer (editor_session /
 *              draft_file) is the source of truth and publish writes it straight to object
 *              storage (`native-publish.ts`).
 *
 * This is NOT about rendering: both kinds render from `sites/{id}/…` through the same
 * `s3Source`, which is why the column is `sourceKind` and not `contentSource` (the latter
 * is already a renderer type — see packages/renderer/lib/content).
 *
 * Pure + DB-free on purpose: this is the ONE dispatch seam for the whole feature, so the
 * rule lives in one unit-tested place instead of a dozen `if (site.repoOwner)` checks.
 * The param type is structural (not `SiteRow`) so callers can pass a partial row and so
 * this compiles either side of the migration.
 */

export type SiteSourceKind = "git" | "native";

export type SiteSourceFields = {
  sourceKind?: string | null;
  repoOwner: string | null;
  repoName: string | null;
};

/**
 * Papervine hosts this site's content. Drives affirmatively-native COPY ("Source:
 * Papervine", the editor's starter-content empty state) — for hiding repo-shaped
 * controls, use `hasGitRepo` instead, which also covers a git site with no repo attached.
 *
 * Anything other than the literal 'native' reads as git, so a legacy row (null column,
 * pre-migration) and a value written by a newer deploy both fall back to today's behavior
 * rather than silently un-gating GitHub calls.
 */
export function isNativeSite(s: SiteSourceFields): boolean {
  return s.sourceKind === "native";
}

/**
 * There is actually a repo behind this site — the honest gate for every repo-shaped
 * control (Re-sync, the Repository row, Git settings, the branch switcher, PR publish).
 * False for a native site AND for a git site whose repo columns are empty (a connect that
 * never completed), both of which would otherwise render controls that can't work.
 */
export function hasGitRepo(s: SiteSourceFields): boolean {
  return !isNativeSite(s) && Boolean(s.repoOwner && s.repoName);
}

/**
 * Can this site serve content at all? The render gate (`request-source.ts`): a native site
 * has no repo but does have storage, so "no repo" must no longer mean "no site".
 */
export function hasRenderableSource(s: SiteSourceFields): boolean {
  return isNativeSite(s) || hasGitRepo(s);
}
