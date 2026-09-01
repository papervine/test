import { TEXT_CONTENT_TYPE } from "./sync-plan";
import { draftAssetPrefix } from "./media-upload";

/**
 * The pure brain of a Papervine-hosted publish (SPEC §10.11) — the storage counterpart to
 * `planSync`. Given the draft buffer's files and what the live revision already holds, decide
 * what to write into the NEW revision and what to report on the deployment row.
 *
 * Kept pure and separate from `native-publish.ts` so the ordering rule below — the part
 * that's actually easy to get wrong — is unit-testable without mocking storage.
 */

/** A draft-buffer row, reduced to what planning needs. Paths are docs-root-relative.
 *  `binary` means the bytes are already in storage under the session's draft prefix and
 *  `content` is empty — publishing one is a copy, not a write. */
export type DraftInput = { path: string; content: string; deleted: boolean; binary?: boolean };

export type NativeWrite = { key: string; content: string; contentType: string };

/** An uploaded asset going live: the same object, one prefix over. */
export type NativeCopy = { from: string; to: string };

export type NativePlan = {
  /** Page and asset writes. Excludes the config, which must land after these. */
  puts: NativeWrite[];
  /** Uploaded assets, copied server-side from the draft prefix. Same phase as `puts` — an
   *  asset is content a page may already reference. */
  copies: NativeCopy[];
  /** The `docs.json` write, if this batch touches it. Written AFTER `puts`. */
  configPuts: NativeWrite[];
  /** Docs-relative paths the draft tombstoned. NOTHING is deleted — these are simply not
   *  carried forward into the new revision, so the previous one keeps them to roll back to. */
  removedPaths: string[];
  /** Docs-relative paths this publish writes, so the caller knows what NOT to carry forward. */
  writtenPaths: string[];
  /** Counters for the deployment row / Activity feed. */
  added: number;
  modified: number;
  removed: number;
};

/**
 * `docs.json` is the navigation: publishing it before the pages it references would leave a
 * reader — for the width of the write window — with sidebar entries that 404. So it goes in
 * its own phase, after the pages. (`mint.json` gets the same treatment: `s3Source` falls
 * back to it, so it's equally load-bearing.)
 */
const CONFIG_PATHS = new Set(["docs.json", "mint.json"]);

/**
 * Plan one publish.
 *
 * `prefix` is the TARGET revision's prefix, and keys are built as `{prefix}{draft path}` —
 * deliberately NOT through authoring-core's `repoPath()`, which re-adds the site's *repo*
 * subdirectory prefix. Draft paths already match the storage key space exactly, and a hosted
 * site's `docsPath` is always `""`, so that helper is a no-op today — but reusing it would
 * silently break the day a git-upgrade flow stamps a target subdirectory onto a hosted site.
 *
 * `existingPaths` is what the site currently serves, as docs-RELATIVE paths. It only classifies
 * added-vs-modified for the Activity feed; it never gates a write. Relative rather than full
 * keys because the source (the live revision) and the target (the new one) sit under different
 * prefixes — comparing full keys across them would report every file as newly added.
 */
export function planNativePublish(
  prefix: string,
  drafts: readonly DraftInput[],
  existingPaths: ReadonlySet<string>,
  /** Session id — needed only to address uploaded bytes at `drafts/{sessionId}/{path}`. */
  sessionId?: string,
): NativePlan {
  const plan: NativePlan = {
    puts: [],
    copies: [],
    configPuts: [],
    removedPaths: [],
    writtenPaths: [],
    added: 0,
    modified: 0,
    removed: 0,
  };

  for (const draft of drafts) {
    const key = `${prefix}${draft.path}`;
    if (draft.deleted) {
      plan.removedPaths.push(draft.path);
      // Only count a removal that was actually published — deleting a page the reader
      // never saw isn't a change to the live site.
      if (existingPaths.has(draft.path)) plan.removed += 1;
      continue;
    }
    if (draft.binary) {
      // An uploaded asset. Its bytes never entered Postgres, so there's nothing to write — the
      // object is copied from the session's draft prefix, keeping the content type it was
      // uploaded under. Skipped entirely without a sessionId, since the source is then
      // unaddressable and writing an EMPTY object over a real asset would be far worse than
      // leaving the previous one in place.
      if (sessionId) {
        plan.copies.push({ from: `${draftAssetPrefix(sessionId)}${draft.path}`, to: key });
        plan.writtenPaths.push(draft.path);
        if (existingPaths.has(draft.path)) plan.modified += 1;
        else plan.added += 1;
      }
      continue;
    }
    // The draft buffer's `content` column is text, so every hosted publish writes text —
    // the same content type syncSite stores repo files under, keeping the two storage
    // writers indistinguishable.
    const write: NativeWrite = { key, content: draft.content, contentType: TEXT_CONTENT_TYPE };
    if (CONFIG_PATHS.has(draft.path)) plan.configPuts.push(write);
    else plan.puts.push(write);
    plan.writtenPaths.push(draft.path);
    if (existingPaths.has(draft.path)) plan.modified += 1;
    else plan.added += 1;
  }

  return plan;
}
