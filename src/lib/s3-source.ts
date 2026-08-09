import "server-only";
import { unstable_cache, revalidateTag } from "next/cache";
import { parseDocsConfig } from "@papervine/renderer/lib/config";
import {
  parsePage,
  PAGE_EXTS,
  type AssetDimensions,
  type ContentSource,
} from "@papervine/renderer/lib/content";
import { getObjectText, listKeys } from "./storage";

/**
 * Next Data Cache tag for a tenant's synced content. The render path reads config +
 * pages + key listings through `unstable_cache` under this tag; a re-sync calls
 * `revalidateSite` to drop it. The content is immutable between syncs (SPEC §3.1
 * model C: copy-on-sync), so caching it indefinitely is correct — every read used to
 * be an R2 round-trip on the dynamic render path (the warm-TTFB cost after the nav
 * fix), and config/docs.json was fetched 3-4× per request. We add a 1h `revalidate`
 * as a safety net so a missed invalidation self-heals.
 */
export function siteContentTag(siteId: string): string {
  return `site-content:${siteId}`;
}

/**
 * Drop a site's cached content after a (re-)sync. Call from the connect/resync actions.
 *
 * NOTE: this is no longer the load-bearing invalidation — the cache key is version-stamped
 * with the synced commit sha (see `s3Source`), so a sync naturally produces fresh keys. We
 * keep the tag bust because it lets a *synchronous* re-sync of the SAME commit (force-push,
 * a manual re-pull) drop stale entries immediately. It does NOT help the push webhook, whose
 * `runSync` runs in `after()` where `revalidateTag` doesn't propagate to the Data Cache —
 * that path relies entirely on the version key below.
 */
export function revalidateSite(siteId: string): void {
  // Next 16 requires a cacheLife profile as the second argument; "max" preserves the
  // pre-16 single-argument behavior (immediate, unconditional invalidation) exactly —
  // Next's own deprecation warning for the old call shape names "max" as the replacement.
  revalidateTag(siteContentTag(siteId), "max");
}

const CACHE = { revalidate: 3600 } as const; // version-keyed on sync; TTL ages out old versions.

// Per-tenant content source reading from object storage (what the sync job wrote).
// This is the production read path (SPEC §3.1 model C) — no GitHub at request time.
// Every read goes through the Data Cache (tagged per site), so warm requests do no R2.
//
// `version` is the site's synced head sha (`lastSyncedCommitSha`). Folding it into the cache
// key makes invalidation content-addressed: a new sync writes a new key, so the render path
// picks up fresh content WITHOUT depending on `revalidateTag` — which the push webhook can't
// rely on, since its sync runs in `after()` (see `revalidateSite`). The caller reads the live
// site row (`getSiteBySlug` is per-request `cache()`, never stale), so the sha is always current.
export function s3Source(siteId: string, version = ""): ContentSource {
  const prefix = `sites/${siteId}/`;
  const tag = siteContentTag(siteId);

  const readConfigRaw = unstable_cache(
    () => readConfigRawUncached(prefix),
    ["s3-config", siteId, version],
    { tags: [tag], ...CACHE },
  );
  const readPageRaw = unstable_cache(
    (key: string) => getObjectText(`${prefix}${key}`),
    ["s3-page", siteId, version],
    { tags: [tag], ...CACHE },
  );
  const readKeys = unstable_cache(() => listKeys(prefix), ["s3-keys", siteId, version], {
    tags: [tag],
    ...CACHE,
  });
  // The dimensions manifest the sync job wrote (sites/{id}/.dimensions.json) — read once per
  // render through the same version-keyed cache as everything else, so a re-sync's fresh dims
  // appear without a tag bust.
  const readDimensions = unstable_cache(
    () => getObjectText(`${prefix}.dimensions.json`),
    ["s3-dimensions", siteId, version],
    { tags: [tag], ...CACHE },
  );
  // Any verbatim docs-relative file (today: the OpenAPI spec a nav division points at) —
  // read through the same version-keyed cache as everything else.
  const readRaw = unstable_cache(
    (key: string) => getObjectText(`${prefix}${key}`),
    ["s3-raw", siteId, version],
    { tags: [tag], ...CACHE },
  );

  return {
    async loadConfig() {
      const raw = await readConfigRaw();
      if (!raw) throw new Error(`Site ${siteId} has no synced config`);
      const { config, warnings } = parseDocsConfig(JSON.parse(raw));
      for (const w of warnings) console.warn(`docs.json: ${w}`);
      return config;
    },
    async loadPage(slug) {
      const normalized = slug === "" || slug === "/" ? "index" : slug;
      for (const ext of PAGE_EXTS) {
        const raw = await readPageRaw(`${normalized}${ext}`);
        if (raw !== null) return parsePage(slug, raw);
      }
      return null;
    },
    async loadRaw(relPath) {
      return readRaw(relPath.replace(/^\//, ""));
    },
    async listPageSlugs() {
      const keys = await readKeys();
      return keys
        .filter((k) => PAGE_EXTS.some((e) => k.endsWith(e)))
        .map((k) => k.slice(prefix.length).replace(/\.mdx?$/, ""))
        .map((s) => (s === "index" ? "" : s));
    },
    async loadAssetDimensions() {
      const raw = await readDimensions();
      if (!raw) return {};
      try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? (parsed as AssetDimensions) : {};
      } catch {
        return {}; // a corrupt/absent manifest just means every image renders as a plain <img>
      }
    },
  };
}

/** docs.json (or mint.json) raw text, or null if neither exists. The cached unit shared
 *  by loadConfig and isSynced, so a page render reads the config once, not three times. */
async function readConfigRawUncached(prefix: string): Promise<string | null> {
  return (
    (await getObjectText(`${prefix}docs.json`)) ?? (await getObjectText(`${prefix}mint.json`))
  );
}

/** Has this site been synced to storage yet? Reads the same cached config blob loadConfig does.
 *  Version-keyed like `s3Source` so a fresh sync isn't masked by a cached `false` — without it,
 *  the first connect caches "not synced" for the full TTL and the site 404s for up to an hour. */
export async function isSynced(siteId: string, version = ""): Promise<boolean> {
  const prefix = `sites/${siteId}/`;
  const readConfigRaw = unstable_cache(
    () => readConfigRawUncached(prefix),
    ["s3-config", siteId, version],
    { tags: [siteContentTag(siteId)], ...CACHE },
  );
  return (await readConfigRaw()) !== null;
}
