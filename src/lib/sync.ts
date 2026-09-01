import "server-only";
import { putObject, getObjectText, listKeys, copyObject } from "./storage";
import { revisionPrefix, planRevisionWrite, runPool, COPY_CONCURRENCY } from "./revisions";
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

// Per-revision sync manifest: maps each synced docs file (docs-relative path) to its GitHub
// blob SHA, so the next sync skips bytes whose content is unchanged and drops files that
// vanished from the repo. The dot-name keeps it out of the render path (it's not a docs file),
// and it lives INSIDE the revision it describes — which is what makes rollback coherent: after
// restoring an older revision the next sync diffs against THAT tree's manifest automatically,
// so it re-fetches exactly what's needed to move forward again rather than trusting a manifest
// describing a tree nobody is serving.
const manifestKey = (prefix: string) => `${prefix}.manifest.json`;

// Sibling of the blob manifest: each raster image's pixel dimensions (docs-relative path →
// {width,height}), measured once at sync time so the render path can give next/image real
// dimensions without re-fetching every image per request. Same dot-name convention keeps it
// out of the render path, and same per-revision placement.
const dimensionsKey = (prefix: string) => `${prefix}.dimensions.json`;

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
  // path always finds docs.json at the revision root no matter where the config lived.
  docsPath?: string;
  // The revision this sync BUILDS — the deployment id (SPEC §10.11). Content is written to
  // `revs/{id}/{revisionId}/` and nothing serves it until `markSiteLive` flips the pointer,
  // so a killed sync leaves an orphan tree rather than a torn live site.
  revisionId: string;
  // The revision this sync builds FROM: the site's current live prefix. Supplies the manifest
  // to diff against and the unchanged bytes to carry forward. On a site that predates revisions
  // this is the legacy flat prefix, which is how such a site migrates on its next sync.
  fromPrefix: string;
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

async function loadManifest(prefix: string): Promise<Record<string, string>> {
  const text = await getObjectText(manifestKey(prefix));
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {}; // a corrupt manifest just forces a full re-fetch — never fail the sync over it
  }
}

async function loadDimensions(prefix: string): Promise<Record<string, ImageDim>> {
  const text = await getObjectText(dimensionsKey(prefix));
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, ImageDim>) : {};
  } catch {
    return {}; // corrupt → next sync re-measures whatever it refetches; missing dims just mean plain <img>
  }
}

/**
 * Copy a repo's docs (config + MDX + assets) into a NEW immutable revision — the
 * copy-on-sync step of SPEC §3.
 *
 * Strategy (the fast path, after two slower iterations — see SPEC §3): enumerate ONLY the
 * docs subtree via the Git tree API (a few requests, scoped — never the whole monorepo),
 * diff its blob SHAs against the last sync's manifest, then pull just the changed/new files
 * and PUT them to storage in one high-concurrency pool that overlaps download and upload.
 * Content comes from the raw.githubusercontent CDN for public repos and the authenticated
 * blobs API for private ones (see fetchContent). **GitHub** cost still scales with the *diff*,
 * not repo size: a first connect pulls everything; a re-sync fetches only what changed, and
 * everything else is carried into the new revision with a server-side copy that never leaves
 * the storage provider. The token never reaches the browser or the render path.
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
  // so the storage key is {revision prefix}{path} directly and the render path resolves as usual.
  const blobs: Blob[] = tree
    .filter((e) => e.type === "blob" && isSyncablePath(e.path))
    .map((e) => ({ path: e.path, sha: e.sha }));

  // 2) Diff against the prior manifest AND what's actually in storage: fetch changed/new
  //    blobs plus anything the manifest claims is synced but the bucket is missing, and
  //    sweep vanished ones. Listing the bucket (one paginated LIST) makes sync self-healing
  //    — the manifest can never permanently hide a missing file (drift), so a plain re-sync
  //    repairs storage with no manual manifest surgery.
  const fromPrefix = site.fromPrefix;
  const toPrefix = revisionPrefix(id, site.revisionId);
  const prior = await loadManifest(fromPrefix);
  const stored = new Set((await listKeys(fromPrefix)).map((k) => k.slice(fromPrefix.length)));
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
      const key = `${toPrefix}${b.path}`;
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

  // 4) Carry forward every unchanged file from the previous revision with a server-side copy
  //    (the bytes never enter this process). Nothing is DELETED anywhere: a file that vanished
  //    from the repo is simply absent from the new manifest, so it isn't copied and the new
  //    revision doesn't contain it — while the old revision keeps it, intact, to roll back to.
  //    That's why `stale` no longer drives a `deleteKeys`; it only feeds the dimension merge.
  //
  //    Copying from `manifest` rather than from `stored` is deliberate: it carries exactly this
  //    revision's file set, so orphaned objects from an older crash don't propagate forward.
  //    A manifest path missing from storage (drift) is already in `toFetch`, so nothing is lost.
  const { copies } = planRevisionWrite({
    fromPrefix,
    toPrefix,
    keep: Object.keys(manifest),
    written: toFetch.map((b) => b.path),
  });
  await runPool(copies, COPY_CONCURRENCY, (c) => copyObject(c.from, c.to));

  // 5) Persist the sidecars LAST, inside the new revision. A crash before this point leaves an
  //    incomplete revision that nothing points at — invisible, and swept by GC — rather than a
  //    half-updated live tree. This is the atomicity the flat prefix could never offer.
  const priorDims = await loadDimensions(fromPrefix);
  const fetchedRasterPaths = toFetch.filter((b) => isRasterImagePath(b.path)).map((b) => b.path);
  const dimensions = mergeAssetDimensions(priorDims, fetchedRasterPaths, measured, stale);
  await putObject(manifestKey(toPrefix), JSON.stringify(manifest), "application/json");
  await putObject(dimensionsKey(toPrefix), JSON.stringify(dimensions), "application/json");

  return { files: blobs.length, uploaded };
}
