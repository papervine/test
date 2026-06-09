import "server-only";
import { putObject } from "./storage";

// File types we copy into object storage on sync: docs config + pages + assets.
const TEXT_EXT = /\.(mdx?|json|ya?ml)$/i;
const ASSET_EXT = /\.(png|jpe?g|gif|svg|webp|avif|ico|bmp|mp4|webm|pdf|woff2?)$/i;

export type SyncResult = { files: number };

function ghHeaders(): HeadersInit {
  const h: Record<string, string> = { accept: "application/vnd.github+json", "user-agent": "papervine" };
  if (process.env.GITHUB_TOKEN) h.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

type SyncSite = { id: string; repoOwner: string; repoName: string; branch: string };

/**
 * Copy a repo's docs (config + MDX + assets) into object storage under
 * sites/{id}/… — the C-lite step of SPEC §3 (copy-on-sync; compile stays on the
 * render path for now). Reads the file list once via the git tree API, then pulls
 * each file from the raw CDN (not rate-limited) and uploads it. The GitHub App
 * token (private repos) plugs in via GITHUB_TOKEN later.
 */
export async function syncSite(site: SyncSite): Promise<SyncResult> {
  const { id, repoOwner: owner, repoName: name, branch } = site;

  const treeRes = await fetch(
    `https://api.github.com/repos/${owner}/${name}/git/trees/${branch}?recursive=1`,
    { headers: ghHeaders() },
  );
  if (!treeRes.ok) throw new Error(`Could not read ${owner}/${name}@${branch} (${treeRes.status})`);
  const tree = ((await treeRes.json()).tree ?? []) as { path: string; type: string }[];
  const files = tree.filter(
    (t) => t.type === "blob" && (TEXT_EXT.test(t.path) || ASSET_EXT.test(t.path)),
  );

  const rawBase = `https://raw.githubusercontent.com/${owner}/${name}/${branch}`;
  let count = 0;
  for (const f of files) {
    const res = await fetch(`${rawBase}/${f.path}`);
    if (!res.ok) continue;
    const key = `sites/${id}/${f.path}`;
    if (ASSET_EXT.test(f.path)) {
      await putObject(key, new Uint8Array(await res.arrayBuffer()), res.headers.get("content-type") ?? undefined);
    } else {
      await putObject(key, await res.text(), "text/plain; charset=utf-8");
    }
    count++;
  }
  return { files: count };
}
