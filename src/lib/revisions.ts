/**
 * Immutable content revisions and the live pointer (SPEC §10.11) — the model behind instant
 * rollback, atomic publishes, and the end of the torn-tree sync race.
 *
 * A **revision** is a complete, immutable content tree at `revs/{siteId}/{revisionId}/`. Its id
 * IS the deployment id that produced it, so there's no separate revision table. Deploying writes
 * a *new* revision and then flips `site.liveRevisionId` to it in `markSiteLive`'s single UPDATE;
 * rolling back flips the same pointer to an older revision. Both are one row write, which is why
 * a rollback is instant and why no reader can ever observe a half-written tree.
 *
 * Three things make this safe, and each is easy to undo by accident:
 *
 * 1. **Revisions live at a top-level `revs/` prefix, NOT under `sites/{id}/`.** The tenant-asset
 *    proxy serves `{live prefix}{...url segments}` with no dot-segment rejection, so nesting
 *    revisions inside the served prefix would publish every historical revision to the internet —
 *    including content someone rolled back precisely to *remove*. A separate top-level prefix
 *    makes that unreachable by construction rather than by a filter someone can forget.
 *
 * 2. **`liveRevisionId === null` means the LEGACY flat `sites/{id}/` prefix.** That single null
 *    check is the entire migration: every pre-revision site keeps serving exactly as it did, and
 *    adopts a revision on its next deploy. Nothing is copied and nothing goes down. Don't
 *    "clean this up" by backfilling — sites that never deploy again are *correctly* left alone.
 *
 * 3. **The generated `skill.md` stays OUTSIDE revisions** (`sites/{id}/.generated/`). It's
 *    written out-of-band by the staleness sweep, which deliberately doesn't bump `updatedAt` and
 *    so must not be version-keyed. See src/lib/skills-source.ts.
 *
 * Everything here is pure and DB-free so it can be unit-tested in isolation
 * (tests/unit/revisions.test.ts) — same split as sync-plan / native-publish-plan / danger-zone.
 */

/** How many revisions to retain per site before GC prunes the oldest. */
export const REVISIONS_PER_SITE = 20;

/**
 * Carrying a revision forward is one server-side copy per unchanged file, so a large docs tree
 * issues a lot of them. Bounded and overlapped rather than `Promise.all` over the whole list:
 * unbounded, a few thousand simultaneous storage requests exhaust the socket pool and start
 * failing on a tree we could have copied comfortably. Higher than the GitHub fetch concurrency
 * because these never leave the storage provider — no download, no rate limit to trip.
 */
export const COPY_CONCURRENCY = 32;

/** Run `task` over `items` with at most `limit` in flight. Shared by both copy-forward paths. */
export async function runPool<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<unknown>,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await task(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** The immutable tree one deployment produced. */
export function revisionPrefix(siteId: string, revisionId: string): string {
  return `revs/${siteId}/${revisionId}/`;
}

/** Every revision of one site — the GC sweep root, and what a site delete must also clear. */
export function siteRevisionsPrefix(siteId: string): string {
  return `revs/${siteId}/`;
}

/**
 * The pre-revision layout: one mutable tree per site, overwritten in place. Still the live
 * prefix for any site that hasn't deployed since revisions landed.
 */
export function legacyPrefix(siteId: string): string {
  return `sites/${siteId}/`;
}

/** The subset of a site row the prefix/version helpers need — keeps them DB- and type-light. */
export type RevisionSite = {
  id: string;
  liveRevisionId: string | null;
  lastSyncedCommitSha?: string | null;
  updatedAt?: Date | string | number | null;
};

/** Where this site's content is served from RIGHT NOW. The one way to ask. */
export function liveContentPrefix(site: RevisionSite): string {
  return site.liveRevisionId
    ? revisionPrefix(site.id, site.liveRevisionId)
    : legacyPrefix(site.id);
}

/**
 * The content-cache version key: what makes `unstable_cache` serve fresh bytes after a deploy.
 *
 * On a revision-backed site the revision id IS the version — content-addressed by definition, so
 * it can't go stale and a rollback to a revision still in cache is a hit rather than a rebuild.
 * Legacy sites keep the historical `${sha}:${updatedAt}` key.
 *
 * This exists because the key was previously built inline in SIX places that had already drifted
 * apart (two used `toISOString()`, one omitted `updatedAt` entirely). A cache key computed two
 * ways is a cache that's wrong one of those ways — route every caller through here.
 */
export function contentVersion(site: RevisionSite): string {
  if (site.liveRevisionId) return site.liveRevisionId;
  const at = site.updatedAt;
  const ms =
    at instanceof Date
      ? at.getTime()
      : typeof at === "number"
        ? at
        : typeof at === "string"
          ? new Date(at).getTime()
          : 0;
  return `${site.lastSyncedCommitSha ?? ""}:${Number.isFinite(ms) ? ms : 0}`;
}

/**
 * Sidecars live at the root of a tree and start with a dot (`.manifest.json`,
 * `.dimensions.json`). They're bookkeeping, not content: `isPageSlug` already hides them from the
 * renderer, and `planConversion` refuses to commit them. Kept here too so the revision writer and
 * the asset proxy share one definition of "not content".
 */
export function isSidecarPath(relPath: string): boolean {
  return relPath.startsWith(".");
}

/**
 * Reject a reader-supplied asset path that tries to escape its tree or read a sidecar.
 *
 * S3 keys have no path semantics — `..` is a literal character, so this isn't traversal in the
 * filesystem sense — but a request for `.manifest.json` today returns the site's git blob-sha map
 * to anyone who asks. Cheap to close, and it keeps the proxy honest as prefixes get richer.
 */
export function isServableAssetPath(relPath: string): boolean {
  if (!relPath) return false;
  return !relPath.split("/").some((seg) => seg === "" || seg.startsWith("."));
}

/**
 * Build the next revision from the last one: bytes we actually have get written, everything else
 * is carried forward with a server-side copy (`copyObject` — the bytes never enter this process).
 *
 * Both write paths already know what changed (`planSync` diffs the manifest, `planNativePublish`
 * diffs the draft buffer), so this only decides *carry-forward*, and deliberately doesn't re-derive
 * the diff. `keep` is the previous revision's full file list; `written` is what the caller is about
 * to put. A path in both is being replaced, so it must NOT also be copied — that's the ordering bug
 * this function exists to make impossible.
 *
 * Pass `fromPrefix: null` for a site's very first revision (nothing to carry).
 */
export function planRevisionWrite(input: {
  fromPrefix: string | null;
  toPrefix: string;
  /** Docs-relative paths that exist in the previous revision. */
  keep: readonly string[];
  /** Docs-relative paths the caller is writing fresh. */
  written: readonly string[];
  /** Docs-relative paths deleted in this deploy — carried forward by neither. */
  removed?: readonly string[];
}): { copies: { from: string; to: string }[] } {
  const { fromPrefix, toPrefix } = input;
  if (!fromPrefix) return { copies: [] };
  const skip = new Set<string>([...input.written, ...(input.removed ?? [])]);
  const copies: { from: string; to: string }[] = [];
  for (const rel of input.keep) {
    if (!rel || rel.endsWith("/")) continue;
    if (skip.has(rel)) continue;
    copies.push({ from: `${fromPrefix}${rel}`, to: `${toPrefix}${rel}` });
  }
  return { copies };
}

/**
 * Which revision prefixes are safe to delete: the oldest beyond `keep`, never the live one.
 *
 * `ordered` is newest-first (the Activity feed's own ordering). The live revision is excluded
 * unconditionally rather than by position, because after a rollback the live revision is NOT the
 * newest — pruning by age alone would delete the tree currently being served.
 */
export function planRevisionGc(input: {
  siteId: string;
  /** Revision ids, newest first. */
  ordered: readonly string[];
  liveRevisionId: string | null;
  keep?: number;
}): string[] {
  const keep = input.keep ?? REVISIONS_PER_SITE;
  const seen = new Set<string>();
  const prune: string[] = [];
  let kept = 0;
  for (const id of input.ordered) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (id === input.liveRevisionId) continue;
    kept += 1;
    if (kept > keep) prune.push(revisionPrefix(input.siteId, id));
  }
  return prune;
}

/** A deployment row, reduced to what rollback eligibility depends on. */
export type RollbackCandidate = {
  id: string;
  status: string;
  target?: string;
  trigger?: string | null;
  revisionId: string | null;
};

/**
 * Whether this deployment can be rolled back to.
 *
 * Requires a successful LIVE deploy that produced a revision we still hold, and that isn't
 * already what we're serving. A failed deploy never flipped the pointer, a preview never pointed
 * at the live site, and a pre-revision row has no bytes — offering any of them a button would
 * promise a restore we can't perform.
 */
export function canRollBack(
  row: RollbackCandidate,
  site: { liveRevisionId: string | null },
): boolean {
  if (row.status !== "successful") return false;
  if ((row.target ?? "live") !== "live") return false;
  if (!row.revisionId) return false;
  return row.revisionId !== site.liveRevisionId;
}

/**
 * Is the site serving something older than the newest content that was actually BUILT? Drives
 * the Overview's "you are rolled back" banner — and on a Git site, the warning that the repo
 * still holds the newer content and the next push will deploy it.
 *
 * Rollback rows are skipped when deciding what "newest" means, and that exclusion is the whole
 * subtlety: a rollback records the revision it restored, so counting it would make the newest
 * row match the live pointer by construction and the banner would never appear — precisely
 * after the one action that should raise it. What matters is the newest *deploy*, since that's
 * the content a Git push or a Studio publish would put back.
 */
export function isRolledBack(
  site: { liveRevisionId: string | null },
  ordered: readonly RollbackCandidate[],
): boolean {
  if (!site.liveRevisionId) return false;
  const newestBuild = ordered.find(
    (r) =>
      r.status === "successful" &&
      (r.target ?? "live") === "live" &&
      r.trigger !== "rollback" &&
      r.revisionId,
  );
  if (!newestBuild?.revisionId) return false;
  return newestBuild.revisionId !== site.liveRevisionId;
}
