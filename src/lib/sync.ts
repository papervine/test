import "server-only";
import { putObject } from "./storage";
import { ghHeaders } from "./github";
import { extractTarGz } from "./tar";

const API = "https://api.github.com";

// File types we copy into object storage on sync: docs config + pages + assets.
const TEXT_EXT = /\.(mdx?|json|ya?ml)$/i;
const ASSET_EXT = /\.(png|jpe?g|gif|svg|webp|avif|ico|bmp|mp4|webm|pdf|woff2?)$/i;

// The tarball gives raw bytes with no content-type, so we infer it from the extension.
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
  // Decrypted GitHub token for private repos (a fine-grained PAT, or a GitHub App
  // installation token — see src/lib/github-token.ts). Absent → public repo.
  token?: string;
  // Normalized subdirectory the docs live in (see normalizeDocsPath); "" = repo root.
  // We sync only files under it and strip the prefix from storage keys, so the render
  // path always finds sites/{id}/docs.json no matter where the config lived in the repo.
  docsPath?: string;
};

/**
 * Copy a repo's docs (config + MDX + assets) into object storage under
 * sites/{id}/… — the C-lite step of SPEC §3 (copy-on-sync; compile stays on the
 * render path for now).
 *
 * The whole tree comes down as ONE tarball request (`GET /repos/{o}/{r}/tarball/{ref}`,
 * same endpoint public and private — the token authenticates it; fetch follows GitHub's
 * 302 to codeload). This replaced per-file fetching (tree API + one blob/raw request per
 * file): at N files that was N round-trips, which put a big private repo right at the
 * serverless time limit and made syncs *intermittently* time out. Now network cost is
 * one download + the S3 uploads, which run pool-parallel. Tradeoff: the archive is the
 * whole repo at that ref and is held in memory (docs repos are small; a code monorepo
 * with a docs/ subdir costs its repo size in RAM — streaming untar is the next step if
 * that ever bites). The token never reaches the browser or the render path.
 */
export async function syncSite(site: SyncSite): Promise<SyncResult> {
  const { id, repoOwner: owner, repoName: name, branch, token } = site;
  // Only sync files under the docs subdirectory, and strip the prefix from storage keys.
  const prefix = site.docsPath ? `${site.docsPath}/` : "";

  const res = await fetch(
    `${API}/repos/${owner}/${name}/tarball/${encodeURIComponent(branch)}`,
    { headers: ghHeaders(token) },
  );
  if (!res.ok) throw new Error(`Could not read ${owner}/${name}@${branch} (${res.status})`);
  const gz = Buffer.from(await res.arrayBuffer());

  // Entries are rooted in {owner}-{repo}-{sha}/ — stripRoot makes paths repo-relative.
  const files = extractTarGz(gz, { stripRoot: true }).filter(
    (f) =>
      (!prefix || f.path.startsWith(prefix)) &&
      (TEXT_EXT.test(f.path) || ASSET_EXT.test(f.path)),
  );

  // Upload with a worker pool (not fixed batches, which stall on their slowest member).
  // The shared cursor is safe: workers interleave only at await points.
  const CONCURRENCY = 16;
  let next = 0;
  let count = 0;
  const upload = async () => {
    while (next < files.length) {
      const f = files[next++];
      const isAsset = ASSET_EXT.test(f.path);
      // f.path is the real repo path; the storage key drops the docs-subdir prefix so
      // the render path resolves sites/{id}/docs.json as usual.
      const key = `sites/${id}/${prefix ? f.path.slice(prefix.length) : f.path}`;
      if (isAsset) {
        await putObject(key, new Uint8Array(f.data), mimeForPath(f.path));
      } else {
        await putObject(key, f.data.toString("utf8"), "text/plain; charset=utf-8");
      }
      count++;
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, files.length) }, upload),
  );
  return { files: count };
}
