import "server-only";
import { putObject, getObjectText, deleteKeys, listKeys } from "./storage";
import { ghHeaders, getRef } from "./github";
import { imageSize } from "image-size";
import {
  isSyncablePath,
  isAssetPath,
  isRasterImagePath,
  mergeAssetDimensions,
  mimeForPath,
  planSync,
  TEXT_CONTENT_TYPE,
  type Blob,
  type ImageDim,
} from "./sync-plan";

const API = "https://api.github.com";

// Per-site sync manifest: maps each synced docs file (docs-relative path) to its GitHub
// blob SHA, so the next sync skips bytes whose content is unchanged and deletes files that
// vanished from the repo. The dot-name keeps it out of the render path (it's not a docs
// file), and it lives under the site prefix so a site delete sweeps it with everything else.
const manifestKey = (id: string) => `sites/${id}/.manifest.json`;

// Sibling of the blob manifest: each raster image's pixel dimensions (docs-relative path →
// {width,height}), measured once at sync time so the render path can give next/image real
// dimensions without re-fetching every image per request. Same dot-name convention keeps it
// out of the render path and under the site prefix (swept on site delete).
const dimensionsKey = (id: string) => `sites/${id}/.dimensions.json`;

// Read an image's pixel dimensions from its raw bytes. Header-only (image-size never decodes
// the full image), and any failure — truncated/corrupt/unknown encoding — yields null so the
// renderer falls back to a plain <img> rather than emitting a wrong width/height.
function measureImage(data: Uint8Array): ImageDim | null {
  try {
    const { width, height } = imageSize(data);
    if (Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0) {
      return { width, height };
    }
  } catch {
    // unreadable image — skip it
  }
  return null;
}

export type SyncResult = {
  // Total docs files now in the site (the full set, for the "N files" framing).
  files: number;
  // How many blobs this sync actually pulled + uploaded (the changed/new diff). On a
  // first connect this equals `files`; on a re-sync it's just what moved.
  uploaded: number;
};

type SyncSite = {
  id: string;
  repoOwner: string;
  repoName: string;
  branch: string;
  // Decrypted GitHub token for private repos (a fine-grained PAT, or a GitHub App
  // installation token — see src/lib/github-token.ts). Absent → public repo.
  token?: string;
  // Whether the repo is private. Drives how blob *content* is fetched: private repos go
  // through the authenticated REST blobs API (5000/hr), public repos through the
  // raw.githubusercontent CDN — which isn't bound by the REST rate limit and, crucially,
  // doesn't trip GitHub's secondary/abuse limit under the concurrent burst we issue (an
  // unauthenticated public repo over the REST API 403s almost immediately).
  isPrivate?: boolean;
  // Normalized subdirectory the docs live in (see normalizeDocsPath); "" = repo root.
  // We resolve and sync only this subtree and store paths relative to it, so the render
  // path always finds sites/{id}/docs.json no matter where the config lived in the repo.
  docsPath?: string;
};

type TreeEntry = { path: string; type: string; sha: string };

// One Git tree listing. `recursive` flattens the whole subtree in a single response;
// `truncated` is GitHub's flag that the subtree exceeded the API's single-response cap.
async function listTree(
  owner: string,
  name: string,
  treeSha: string,
  token: string | undefined,
  recursive: boolean,
): Promise<{ tree: TreeEntry[]; truncated: boolean }> {
  const res = await fetch(
    `${API}/repos/${owner}/${name}/git/trees/${treeSha}${recursive ? "?recursive=1" : ""}`,
    { headers: ghHeaders(token) },
  );
  if (!res.ok) throw new Error(`Could not read tree of ${owner}/${name} (${res.status})`);
  const data = await res.json();
  return { tree: (data.tree ?? []) as TreeEntry[], truncated: !!data.truncated };
}

// Walk from a root tree SHA down to the docs subdirectory's tree SHA (the root itself when
// docsPath is ""). One non-recursive listing per path segment — a handful of requests
// regardless of repo size — so the recursive enumeration that follows is scoped to docs/
// only and never touches the rest of a monorepo.
async function walkToDocsTree(
  owner: string,
  name: string,
  rootTreeSha: string,
  token: string | undefined,
  docsPath: string,
  branch: string,
): Promise<string> {
  let treeSha = rootTreeSha;
  for (const seg of docsPath.split("/").filter(Boolean)) {
    const { tree } = await listTree(owner, name, treeSha, token, false);
    const dir = tree.find((e) => e.type === "tree" && e.path === seg);
    if (!dir) throw new Error(`docs path '${docsPath}' not found in ${owner}/${name}@${branch}`);
    treeSha = dir.sha;
  }
  return treeSha;
}

// Where to read a file's content from. Public repos use the raw.githubusercontent CDN
// (keyed by commit SHA + repo-relative path) — not REST-rate-limited and safe under the
// concurrent burst we issue. Private repos use the authenticated REST blobs API (keyed by
// blob SHA, `raw` media type → no base64 bloat), which the token authorizes at 5000/hr.
type ContentRef = { isPrivate: boolean; commitSha: string; repoPath: string; blobSha: string };

// A 4xx that won't get better on retry (e.g. 404) — propagated immediately, unlike a
// rate-limit/5xx/network blip, which we back off and retry.
class NonRetryableError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchContent(
  owner: string,
  name: string,
  ref: ContentRef,
  token: string | undefined,
): Promise<Buffer> {
  const url = ref.isPrivate
    ? `${API}/repos/${owner}/${name}/git/blobs/${ref.blobSha}`
    : `https://raw.githubusercontent.com/${owner}/${name}/${ref.commitSha}/${ref.repoPath
        .split("/")
        .map(encodeURIComponent)
        .join("/")}`;
  const headers = ref.isPrivate
    ? { ...(ghHeaders(token) as Record<string, string>), accept: "application/vnd.github.raw" }
    : (ghHeaders(token) as Record<string, string>);

  // Retry rate-limits (403/429), transient 5xx, AND thrown network errors — under our
  // concurrent burst a keep-alive socket gets dropped or a body stream aborted often enough
  // that undici throws `TypeError: terminated`. The whole fetch+body read sits in the try so
  // a mid-download abort retries too; a per-request timeout turns a hung socket into a fast
  // retry instead of a 40s stall. Without this, one transient drop among hundreds of files
  // would fail the entire sync.
  const MAX_ATTEMPTS = 5;
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(60_000) });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      const retryable = res.status === 429 || res.status === 403 || res.status >= 500;
      if (!retryable) throw new NonRetryableError(`Could not read ${ref.repoPath} (${res.status})`);
      lastErr = new Error(`HTTP ${res.status}`);
      const retryAfter = Number(res.headers.get("retry-after"));
      if (attempt < MAX_ATTEMPTS - 1) {
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt);
      }
    } catch (e) {
      if (e instanceof NonRetryableError) throw e;
      lastErr = e; // network error / abort / body terminated — back off and retry
      if (attempt < MAX_ATTEMPTS - 1) await sleep(500 * 2 ** attempt);
    }
  }
  const detail = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(`Could not read ${ref.repoPath} after ${MAX_ATTEMPTS} attempts (${detail})`);
}

async function loadManifest(id: string): Promise<Record<string, string>> {
  const text = await getObjectText(manifestKey(id));
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {}; // a corrupt manifest just forces a full re-fetch — never fail the sync over it
  }
}

async function loadDimensions(id: string): Promise<Record<string, ImageDim>> {
  const text = await getObjectText(dimensionsKey(id));
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, ImageDim>) : {};
  } catch {
    return {}; // corrupt → next sync re-measures whatever it refetches; missing dims just mean plain <img>
  }
}

/**
 * Copy a repo's docs (config + MDX + assets) into object storage under sites/{id}/… — the
 * copy-on-sync step of SPEC §3.
 *
 * Strategy (the fast path, after two slower iterations — see SPEC §3): enumerate ONLY the
 * docs subtree via the Git tree API (a few requests, scoped — never the whole monorepo),
 * diff its blob SHAs against the last sync's manifest, then pull just the changed/new files
 * and PUT them to storage in one high-concurrency pool that overlaps download and upload.
 * Content comes from the raw.githubusercontent CDN for public repos and the authenticated
 * blobs API for private ones (see fetchContent). Cost scales with the *diff*, not repo size:
 * a first connect pulls everything; a re-sync moves only what changed and deletes what
 * vanished. The token never reaches the browser or the render path.
 *
 * The earlier per-file approach was N tree-walk round-trips (slow); the tarball that
 * replaced it downloaded+gunzipped the *entire* repo to harvest a docs/ subdir (a private
 * monorepo could take >300s and blow the function limit). This gets the scoping of per-file
 * with the parallelism the tarball lacked.
 */
export async function syncSite(site: SyncSite): Promise<SyncResult> {
  const { id, repoOwner: owner, repoName: name, branch, token } = site;
  const docsPath = site.docsPath ?? "";
  const isPrivate = site.isPrivate ?? false;

  // 1) Resolve the branch head (commit SHA pins the raw-CDN reads; tree SHA roots the walk),
  //    then enumerate only the docs subtree in one recursive tree request.
  const head = await getRef(owner, name, branch, token);
  if (!head) throw new Error(`Could not resolve ${owner}/${name}@${branch}`);
  const treeSha = await walkToDocsTree(owner, name, head.treeSha, token, docsPath, branch);
  const { tree, truncated } = await listTree(owner, name, treeSha, token, true);
  if (truncated) {
    // >100k entries under docs/ — beyond the tree API's single-response cap. Fail loudly
    // rather than sync a silent partial set. (A sparse git clone in a worker is the escape
    // hatch for a docs tree this large — SPEC §3.)
    throw new Error(`docs tree of ${owner}/${name}@${branch} is too large to enumerate (truncated)`);
  }
  // Recursive listing of a subtree yields docs-relative paths already (no prefix to strip),
  // so the storage key is sites/{id}/{path} directly and the render path resolves as usual.
  const blobs: Blob[] = tree
    .filter((e) => e.type === "blob" && isSyncablePath(e.path))
    .map((e) => ({ path: e.path, sha: e.sha }));

  // 2) Diff against the prior manifest AND what's actually in storage: fetch changed/new
  //    blobs plus anything the manifest claims is synced but the bucket is missing, and
  //    sweep vanished ones. Listing the bucket (one paginated LIST) makes sync self-healing
  //    — the manifest can never permanently hide a missing file (drift), so a plain re-sync
  //    repairs storage with no manual manifest surgery.
  const prior = await loadManifest(id);
  const prefix = `sites/${id}/`;
  const stored = new Set((await listKeys(prefix)).map((k) => k.slice(prefix.length)));
  const { fetch: toFetch, manifest, stale } = planSync(blobs, prior, stored);

  // 3) Pipeline fetch→upload in one worker pool (not fixed batches, which stall on their
  //    slowest member). Each worker pulls the next changed blob raw and immediately PUTs it,
  //    overlapping GitHub download and S3 upload. Concurrency is bounded to stay under
  //    GitHub's secondary rate limits. The shared cursor is safe: workers interleave only at
  //    await points.
  // Moderate concurrency: high enough to hide per-request latency, low enough that GitHub's
  // (and the CDN's) keep-alive pool doesn't shed sockets — fewer dropped connections to retry.
  const CONCURRENCY = 12;
  let next = 0;
  let uploaded = 0;
  // Pixel dimensions measured this sync (docs-relative path → {w,h}). Workers only write
  // distinct keys and only between awaits, so the shared object is safe without a lock.
  const measured: Record<string, ImageDim> = {};
  const worker = async () => {
    while (next < toFetch.length) {
      const b = toFetch[next++];
      const repoPath = docsPath ? `${docsPath}/${b.path}` : b.path;
      const data = await fetchContent(owner, name, { isPrivate, commitSha: head.commitSha, repoPath, blobSha: b.sha }, token);
      const key = `sites/${id}/${b.path}`;
      if (isAssetPath(b.path)) {
        await putObject(key, new Uint8Array(data), mimeForPath(b.path));
        if (isRasterImagePath(b.path)) {
          const dim = measureImage(data);
          if (dim) measured[b.path] = dim;
        }
      } else {
        await putObject(key, data.toString("utf8"), TEXT_CONTENT_TYPE);
      }
      uploaded++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, toFetch.length) }, worker));

  // 4) Sweep files that disappeared from the repo, then persist the manifests LAST — so a
  //    crash mid-sync leaves the previous manifest and the next run re-reconciles in full.
  if (stale.length) await deleteKeys(stale.map((p) => `sites/${id}/${p}`));
  const priorDims = await loadDimensions(id);
  const fetchedRasterPaths = toFetch.filter((b) => isRasterImagePath(b.path)).map((b) => b.path);
  const dimensions = mergeAssetDimensions(priorDims, fetchedRasterPaths, measured, stale);
  await putObject(manifestKey(id), JSON.stringify(manifest), "application/json");
  await putObject(dimensionsKey(id), JSON.stringify(dimensions), "application/json");

  return { files: blobs.length, uploaded };
}
