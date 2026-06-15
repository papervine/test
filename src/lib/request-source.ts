import "server-only";
import { headers } from "next/headers";
import { resolveTenantSlug, getSiteBySlug } from "./tenant";
import { s3Source, isSynced } from "./s3-source";
import { draftSource } from "./draft-source";
import type { ContentSource } from "@papervine/renderer/lib/content";

/**
 * The content source for the current request's tenant, or null on the apex/preview
 * host (where the default fsSource applies).
 *
 * Why this exists: the root layout renders for *every* route, including a tenant's
 * `/sites/{slug}` docs — but it runs BEFORE any route sets `contentContext`, so its
 * `loadConfig()` reads the default `content/` repo. Because `loadConfig` is memoized
 * per-request with React `cache()`, that default config then sticks for the whole
 * render: the tenant page later calls `loadConfig()` inside its `contentContext.run`
 * and gets the cached *default* config (wrong nav) while `loadPage` reads the tenant's
 * real content — so the sidebar shows our repo's pages and every such link 404s.
 *
 * Resolving the source here and reading config inside `contentContext.run(src, …)` in
 * BOTH the root layout and the tenant page keeps every content read in one request on
 * the same source. `getSiteBySlug` is cached, so calling this in both places is cheap.
 *
 * Pass `slugOverride` when the route already knows its tenant (the `/sites/[site]`
 * param); otherwise we read it from the `x-papervine-site` header (set by middleware,
 * including apex path-mode `/sites/{slug}`) and fall back to the subdomain host.
 *
 * Pass `opts.draftBranch` ONLY from editor surfaces (the web editor, the editing-agent
 * route, the authoring MCP). When present and an open edit session exists for that branch,
 * reads come through the draft overlay (`draftSource`) so uncommitted edits are visible.
 * The public render path and public `/mcp` never pass it, so live serving is unchanged.
 */
export async function requestContentSource(
  slugOverride?: string,
  opts?: { draftBranch?: string },
): Promise<ContentSource | null> {
  const h = await headers();
  const slug = slugOverride ?? h.get("x-papervine-site") ?? resolveTenantSlug(h.get("host"));
  if (!slug) return null;

  const record = await getSiteBySlug(slug);
  if (!record?.repoOwner || !record.repoName) return null;

  // Everything serves from our own object storage (SPEC §3.1 model C). The sync job —
  // on connect, on re-sync, and in the dev seed — copies the repo's config + pages +
  // assets into sites/{id}/…, and the render path reads ONLY from there: no GitHub at
  // request time. A site that hasn't been synced yet has nothing to show → null (the
  // route 404s) rather than reaching back to the repo live.
  // Key the content cache to the synced head sha so a new sync's content is served
  // immediately. This is the real invalidation for the push webhook (its sync runs in
  // `after()`, where `revalidateTag` doesn't reach the Data Cache). `record` is read live
  // (`getSiteBySlug` is per-request `cache()`), so this sha advances the moment a sync lands.
  const version = record.lastSyncedCommitSha ?? "";
  if (!(await isSynced(record.id, version))) return null;
  if (opts?.draftBranch) return draftSource(record.id, opts.draftBranch, version);
  return s3Source(record.id, version);
}
