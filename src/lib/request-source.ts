import "server-only";
import { headers, cookies } from "next/headers";
import { resolveTenantSlug, getSiteBySlug, getSiteByCustomDomain } from "./tenant";
import { s3Source, isSynced } from "./s3-source";
import { draftSource } from "./draft-source";
import { READER_COOKIE } from "./reader-session";
import { accessForRecord } from "./reader-access";
import type { ContentSource } from "@papervine/renderer/lib/content";
import type { PageAccess } from "@papervine/renderer/lib/nav";

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

  // A custom domain (docs.example.com) carries no slug — middleware forwards the raw Host as
  // `x-papervine-host` and the slug resolvers return null. We MUST still resolve the tenant
  // here, because the ROOT layout calls requestContentSource() (no slugOverride) to prime
  // the per-request React `cache()` entry for `loadConfig()`. Without this fallback it gets
  // null → primes the DEFAULT content source → the memoized default config sticks for the
  // whole render, so a custom-domain page's nav reads the wrong (default/empty) docs.json
  // even though its PAGES read the tenant's S3 content (the "pages render, sidebar/tabs
  // empty on a custom domain" bug). The slug paths (subdomain / apex `/sites`) prime fine.
  const record = slug
    ? await getSiteBySlug(slug)
    : await getSiteByCustomDomain(h.get("x-papervine-host") ?? h.get("host") ?? "");
  if (!record?.repoOwner || !record.repoName) return null;

  // Everything serves from our own object storage (SPEC §3.1 model C). The sync job —
  // on connect, on re-sync, and in the dev seed — copies the repo's config + pages +
  // assets into sites/{id}/…, and the render path reads ONLY from there: no GitHub at
  // request time. A site that hasn't been synced yet has nothing to show → null (the
  // route 404s) rather than reaching back to the repo live.
  // Key the content cache to the synced head sha AND the row's updatedAt, so the cache
  // busts on EVERY successful sync — not only when the commit sha changes. Re-syncing the
  // SAME commit (a force-push, a manual re-pull, or a reconcile that repaired drift) bumps
  // updatedAt → a fresh key. Keying on the sha alone left the Data Cache serving the
  // pre-sync content under the unchanged sha — the "page fresh but sidebar/tabs stale after
  // a same-commit re-sync" bug, since docs.json (nav) stayed cached while newly-visited
  // pages missed and read fresh. `record` is read live (`getSiteBySlug` is per-request
  // `cache()`), and the sync runner bumps updatedAt on every success, so this is always current.
  const syncedAt = record.updatedAt instanceof Date ? record.updatedAt.getTime() : 0;
  const version = `${record.lastSyncedCommitSha ?? ""}:${syncedAt}`;
  if (!(await isSynced(record.id, version))) return null;
  if (opts?.draftBranch) return draftSource(record.id, opts.draftBranch, version);
  return s3Source(record.id, version);
}

/**
 * The public asset base for the current request's tenant — the slug-keyed
 * `/api/tenant-asset/{slug}` proxy that streams the tenant's synced static files (favicon,
 * logo, images) on ANY host. Empty string on the apex/preview host, where assets are
 * root-absolute. Mirrors requestContentSource's tenant resolution (subdomain / apex path
 * `x-papervine-site` / custom-domain Host) so the asset base always matches the config
 * source. Call it only once you know there IS a tenant (e.g. requestContentSource returned
 * non-null), so the slug is guaranteed resolvable.
 */
/**
 * The reader access predicate for the current request's tenant (SPEC §11.2), resolving the
 * tenant the SAME way `requestContentSource` does so the gate matches the content it filters.
 * Used by the retrieval surfaces — Cmd-K search, the AI assistant, the MCP server — to drop
 * pages the reader can't open. Returns ALLOW_ALL when there's no tenant or the site isn't
 * gated (see `accessForRecord`).
 *
 * Pass `{ anonymous: true }` for transports with no reader session — the MCP server, where
 * external agents carry no docs cookie, so they see only the public/un-gated subset.
 */
export async function requestReaderAccess(
  slugOverride?: string,
  opts?: { anonymous?: boolean },
): Promise<PageAccess> {
  const h = await headers();
  const slug = slugOverride ?? h.get("x-papervine-site") ?? resolveTenantSlug(h.get("host"));
  const record = slug
    ? await getSiteBySlug(slug)
    : await getSiteByCustomDomain(h.get("x-papervine-host") ?? h.get("host") ?? "");
  const cookieValue = opts?.anonymous ? undefined : (await cookies()).get(READER_COOKIE)?.value;
  return accessForRecord(record, cookieValue, opts);
}

export async function requestAssetBase(): Promise<string> {
  const h = await headers();
  const slug = h.get("x-papervine-site") ?? resolveTenantSlug(h.get("host"));
  if (slug) return `/api/tenant-asset/${slug}`;
  const record = await getSiteByCustomDomain(h.get("x-papervine-host") ?? h.get("host") ?? "");
  return record ? `/api/tenant-asset/${record.slug}` : "";
}

/**
 * A stable cache key for the search index of the current request's tenant — site id + the synced
 * version (sha:updatedAt). The search index (src/lib/search.ts) is reader-INDEPENDENT (the
 * per-page gate is applied per query) and changes only on (re-)sync, so keying an in-process
 * cache on this lets the index be built once per version per process instead of rebuilt on every
 * keystroke. Mirrors `requestContentSource`'s tenant resolution + version. Returns null on the
 * apex/preview host (no stable version → search.ts keeps its per-request build so `papervine dev`
 * live edits stay fresh). `getSiteBySlug` is per-request `cache()`d, so this is ~free.
 */
export async function requestSearchIndexKey(slugOverride?: string): Promise<string | null> {
  const h = await headers();
  const slug = slugOverride ?? h.get("x-papervine-site") ?? resolveTenantSlug(h.get("host"));
  const record = slug
    ? await getSiteBySlug(slug)
    : await getSiteByCustomDomain(h.get("x-papervine-host") ?? h.get("host") ?? "");
  if (!record) return null;
  const syncedAt = record.updatedAt instanceof Date ? record.updatedAt.getTime() : 0;
  return `${record.id}:${record.lastSyncedCommitSha ?? ""}:${syncedAt}`;
}
