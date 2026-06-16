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
 * The incremental brain of the sync. Given the repo's current docs blobs (path → SHA)
 * and the manifest persisted by the previous sync, decide:
 *   - which blobs to (re)fetch (SHA changed or path is new — content-addressed, so an
 *     unchanged file is skipped no matter how the rest of the repo moved),
 *   - the manifest to write back, and
 *   - which now-removed paths to sweep from storage.
 * So sync cost scales with the *diff*, not the repo (or even the docs tree) size.
 */
export function planSync(blobs: Blob[], prior: Record<string, string>): SyncPlan {
  const manifest: Record<string, string> = {};
  const fetch: Blob[] = [];
  for (const b of blobs) {
    manifest[b.path] = b.sha;
    if (prior[b.path] !== b.sha) fetch.push(b);
  }
  const present = new Set(blobs.map((b) => b.path));
  const stale = Object.keys(prior).filter((p) => !present.has(p));
  return { fetch, manifest, stale };
}
