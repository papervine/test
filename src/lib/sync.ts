import "server-only";
import { putObject } from "./storage";
import { ghHeaders } from "./github";

const API = "https://api.github.com";

// File types we copy into object storage on sync: docs config + pages + assets.
const TEXT_EXT = /\.(mdx?|json|ya?ml)$/i;
const ASSET_EXT = /\.(png|jpe?g|gif|svg|webp|avif|ico|bmp|mp4|webm|pdf|woff2?)$/i;

// The blobs API returns raw bytes without a meaningful content-type, so for private
// assets we infer the type from the extension (public assets keep the raw CDN's header).
// The tenant-asset route serves whatever content-type we store, so getting it right matters.
const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  svg: "image/svg+xml", webp: "image/webp", avif: "image/avif", ico: "image/x-icon",
  bmp: "image/bmp", mp4: "video/mp4", webm: "video/webm", pdf: "application/pdf",
  woff: "font/woff", woff2: "font/woff2",
};
function mimeForPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return MIME[ext] ?? "application/octet-stream";
}

export type SyncResult = { files: number };

type SyncSite = {
  id: string;
  repoOwner: string;
  repoName: string;
  branch: string;
  // Decrypted GitHub token for private repos (fine-grained PAT today, GitHub App
  // installation token later). Absent → public repo, served from the raw CDN.
  token?: string;
  // Normalized subdirectory the docs live in (see normalizeDocsPath); "" = repo root.
  // We sync only files under it and strip the prefix from storage keys, so the render
  // path always finds sites/{id}/docs.json no matter where the config lived in the repo.
  docsPath?: string;
};

/**
 * Copy a repo's docs (config + MDX + assets) into object storage under
 * sites/{id}/… — the C-lite step of SPEC §3 (copy-on-sync; compile stays on the
 * render path for now). Reads the file list once via the git tree API, then pulls
 * each file's bytes and uploads it.
 *
 * Public repos: pull from the raw CDN (`raw.githubusercontent.com`, not rate-limited).
 * Private repos: the raw CDN can't serve them (it has no Authorization), so pull each
 * blob through the authenticated git blobs API by sha (`Accept: raw`). The token is
 * held only here on the server; it never reaches the browser or the render path.
 */
export async function syncSite(site: SyncSite): Promise<SyncResult> {
  const { id, repoOwner: owner, repoName: name, branch, token } = site;
  const headers = ghHeaders(token);
  // Only sync files under the docs subdirectory, and strip the prefix from storage keys.
  const prefix = site.docsPath ? `${site.docsPath}/` : "";

  const treeRes = await fetch(
    `${API}/repos/${owner}/${name}/git/trees/${branch}?recursive=1`,
    { headers },
  );
  if (!treeRes.ok) throw new Error(`Could not read ${owner}/${name}@${branch} (${treeRes.status})`);
  const tree = ((await treeRes.json()).tree ?? []) as { path: string; type: string; sha: string }[];
  const files = tree.filter(
    (t) =>
      t.type === "blob" &&
      (!prefix || t.path.startsWith(prefix)) &&
      (TEXT_EXT.test(t.path) || ASSET_EXT.test(t.path)),
  );

  const rawBase = `https://raw.githubusercontent.com/${owner}/${name}/${branch}`;

  // Fetch one file's bytes and upload it; returns true if it landed. Private repos pull
  // each blob through the authenticated API (the raw CDN can't serve them); public repos
  // use the CDN. A single bad file is skipped, not fatal — the rest of the sync proceeds.
  const syncOne = async (f: { path: string; sha: string }): Promise<boolean> => {
    const isAsset = ASSET_EXT.test(f.path);
    let bytes: ArrayBuffer;
    let contentType: string | undefined;
    if (token) {
      // Private: fetch the blob by sha with the raw media type → exact file bytes.
      const res = await fetch(`${API}/repos/${owner}/${name}/git/blobs/${f.sha}`, {
        headers: { ...headers, accept: "application/vnd.github.raw" },
      });
      if (!res.ok) return false;
      bytes = await res.arrayBuffer();
      contentType = isAsset ? mimeForPath(f.path) : "text/plain; charset=utf-8";
    } else {
      // Public: the raw CDN, which serves with a usable content-type for assets.
      const res = await fetch(`${rawBase}/${f.path}`);
      if (!res.ok) return false;
      bytes = await res.arrayBuffer();
      contentType = isAsset ? (res.headers.get("content-type") ?? undefined) : "text/plain; charset=utf-8";
    }
    // f.path is the real repo path (used above to fetch bytes); the storage key drops
    // the docs-subdir prefix so the render path resolves sites/{id}/docs.json as usual.
    const key = `sites/${id}/${prefix ? f.path.slice(prefix.length) : f.path}`;
    if (isAsset) {
      await putObject(key, new Uint8Array(bytes), contentType);
    } else {
      await putObject(key, new TextDecoder().decode(bytes), contentType);
    }
    return true;
  };

  // Fetch+upload in bounded-concurrency batches. Sequential was the long pole for private
  // repos (one round-trip per blob): a docs tree of N files took N×latency, which blew
  // past the serverless time limit on a big repo (connect would hang then 500). 8-wide
  // keeps us well under GitHub's secondary rate limit while cutting wall-time ~8×.
  const CONCURRENCY = 8;
  let count = 0;
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const batch = files.slice(i, i + CONCURRENCY);
    const landed = await Promise.all(batch.map((f) => syncOne(f)));
    count += landed.filter(Boolean).length;
  }
  return { files: count };
}
