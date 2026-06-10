import "server-only";
import { unstable_cache, revalidateTag } from "next/cache";
import { parseDocsConfig } from "./config";
import { parsePage, PAGE_EXTS, type ContentSource } from "./content";
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
function siteContentTag(siteId: string): string {
  return `site-content:${siteId}`;
}

/** Drop a site's cached content after a (re-)sync. Call from the connect/resync actions. */
export function revalidateSite(siteId: string): void {
  revalidateTag(siteContentTag(siteId));
}

const CACHE = { revalidate: 3600 } as const; // tag-invalidated on sync; TTL is a safety net.

// Per-tenant content source reading from object storage (what the sync job wrote).
// This is the production read path (SPEC §3.1 model C) — no GitHub at request time.
// Every read goes through the Data Cache (tagged per site), so warm requests do no R2.
export function s3Source(siteId: string): ContentSource {
  const prefix = `sites/${siteId}/`;
  const tag = siteContentTag(siteId);

  const readConfigRaw = unstable_cache(
    () => readConfigRawUncached(prefix),
    ["s3-config", siteId],
    { tags: [tag], ...CACHE },
  );
  const readPageRaw = unstable_cache(
    (key: string) => getObjectText(`${prefix}${key}`),
    ["s3-page", siteId],
    { tags: [tag], ...CACHE },
  );
  const readKeys = unstable_cache(() => listKeys(prefix), ["s3-keys", siteId], {
    tags: [tag],
    ...CACHE,
  });

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
    async listPageSlugs() {
      const keys = await readKeys();
      return keys
        .filter((k) => PAGE_EXTS.some((e) => k.endsWith(e)))
        .map((k) => k.slice(prefix.length).replace(/\.mdx?$/, ""))
        .map((s) => (s === "index" ? "" : s));
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

/** Has this site been synced to storage yet? Reads the same cached config blob loadConfig does. */
export async function isSynced(siteId: string): Promise<boolean> {
  const prefix = `sites/${siteId}/`;
  const readConfigRaw = unstable_cache(() => readConfigRawUncached(prefix), ["s3-config", siteId], {
    tags: [siteContentTag(siteId)],
    ...CACHE,
  });
  return (await readConfigRaw()) !== null;
}
