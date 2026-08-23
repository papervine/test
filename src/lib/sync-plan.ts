// Pure planning logic for the repo → object-storage sync (no I/O, no `server-only`), so
// it can be unit-tested. The orchestration that resolves the tree, fetches blobs, and
// writes object storage lives in sync.ts; this module only decides *what* to move and
// *which* content-type to stamp. Kept pure on purpose — see CLAUDE.md ("extract pure
// helpers; server files can't export sync helpers").

// File types we copy into object storage on sync: docs config + pages + assets.
export const TEXT_EXT = /\.(mdx?|json|ya?ml)$/i;
export const ASSET_EXT = /\.(png|jpe?g|gif|svg|webp|avif|ico|bmp|mp4|webm|pdf|woff2?)$/i;

export function isSyncablePath(path: string): boolean {
  return TEXT_EXT.test(path) || ASSET_EXT.test(path);
}

export function isAssetPath(path: string): boolean {
  return ASSET_EXT.test(path);
}

// The raster formats whose pixel dimensions we measure at sync time so the renderer can
// hand width/height to next/image (CLS-free, optimized + responsive `srcset`). Deliberately
// narrower than ASSET_EXT: gif is excluded so animation survives (it renders as a plain
// <img>, not a next/image static frame), and svg/ico/video/pdf/font carry no useful raster
// dimensions. Anything outside this set just degrades to a lazy <img> at render time.
export const RASTER_IMAGE_EXT = /\.(png|jpe?g|webp|avif|bmp)$/i;

export function isRasterImagePath(path: string): boolean {
  return RASTER_IMAGE_EXT.test(path);
}

// Pixel dimensions of one image, keyed by its docs-relative path in the dimensions manifest.
export type ImageDim = { width: number; height: number };

/**
 * Reconcile the persisted dimensions manifest with what this (incremental) sync touched.
 * Like the blob manifest, sync only refetched the *changed* blobs, so we carry forward dims
 * for untouched images and only revise what moved:
 *   - every refetched raster image is invalidated first (its old dims are stale) then…
 *   - …re-set from `measured` if we could read it (a failed measure leaves it absent → the
 *     renderer falls back to a plain <img>, never a wrong width/height), and
 *   - paths that vanished from the repo (`stale`) are dropped.
 * Pure so it can be unit-tested without S3 or GitHub.
 */
export function mergeAssetDimensions(
  prior: Record<string, ImageDim>,
  fetchedRasterPaths: string[],
  measured: Record<string, ImageDim>,
  stale: string[],
): Record<string, ImageDim> {
  const out = { ...prior };
  for (const p of fetchedRasterPaths) delete out[p];
  for (const p of stale) delete out[p];
  Object.assign(out, measured);
  return out;
}

// The tree/blob API gives raw bytes with no content-type, so we infer it from the
// extension. The tenant-asset route serves whatever content-type we store, so getting it
// right matters.
const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  svg: "image/svg+xml", webp: "image/webp", avif: "image/avif", ico: "image/x-icon",
  bmp: "image/bmp", mp4: "video/mp4", webm: "video/webm", pdf: "application/pdf",
  woff: "font/woff", woff2: "font/woff2",
};
export function mimeForPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return MIME[ext] ?? "application/octet-stream";
}

/**
 * The content type every *text* docs file is stored under — MDX, Markdown, `docs.json`,
 * OpenAPI YAML, all of it. Deliberately uniform (and deliberately not `application/json`
 * for the config): the render path reads these with `getObjectText`, never serves them to a
 * browser by content type, so one value keeps storage written by the repo sync and storage
 * written by a Papervine-hosted publish byte-for-byte indistinguishable. Only binary assets
 * get a real type, via `mimeForPath`.
 */
export const TEXT_CONTENT_TYPE = "text/plain; charset=utf-8";

// One docs file in the repo: its docs-relative path and its GitHub blob SHA (content id).
export type Blob = { path: string; sha: string };

export type SyncPlan = {
  // Blobs whose content changed (or are new) since the last sync — the only bytes to pull.
  fetch: Blob[];
  // The manifest to persist after this sync: every current docs file → its blob SHA.
  manifest: Record<string, string>;
  // Docs-relative paths present last sync but gone now — their storage objects to delete.
  stale: string[];
};

/**
 * The incremental brain of the sync. Given the repo's current docs blobs (path → SHA),
 * the manifest persisted by the previous sync, and (optionally) the set of docs-relative
 * paths actually present in object storage, decide:
 *   - which blobs to (re)fetch (SHA changed, path is new, OR the object is missing from
 *     storage — so an unchanged-and-present file is skipped no matter how the rest of the
 *     repo moved),
 *   - the manifest to write back, and
 *   - which now-removed paths to sweep from storage.
 * So sync cost scales with the *diff*, not the repo (or even the docs tree) size.
 *
 * `stored` makes sync **self-healing**: the manifest is a fast-path hint, not the source of
 * truth for what's in storage. If the manifest drifts ahead of storage (records a file as
 * synced that isn't actually there — an interrupted/raced sync, a lost upload), a plain
 * re-sync still re-fetches it, because we re-fetch anything storage lacks regardless of what
 * the manifest claims. Omit `stored` (unit tests, or to skip the listing) for manifest-only
 * diffing.
 */
export function planSync(
  blobs: Blob[],
  prior: Record<string, string>,
  stored?: ReadonlySet<string>,
): SyncPlan {
  const manifest: Record<string, string> = {};
  const fetch: Blob[] = [];
  for (const b of blobs) {
    manifest[b.path] = b.sha;
    const changed = prior[b.path] !== b.sha;
    const missing = stored !== undefined && !stored.has(b.path);
    if (changed || missing) fetch.push(b);
  }
  const present = new Set(blobs.map((b) => b.path));
  const stale = Object.keys(prior).filter((p) => !present.has(p));
  return { fetch, manifest, stale };
}
