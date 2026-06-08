import "server-only";
import { parseDocsConfig } from "./config";
import { parsePage, PAGE_EXTS, type ContentSource } from "./content";
import { getObjectText, listKeys } from "./storage";

// Per-tenant content source reading from object storage (what the sync job wrote).
// This is the production read path (SPEC §3.1 model C) — no GitHub at request time.
export function s3Source(siteId: string): ContentSource {
  const prefix = `sites/${siteId}/`;
  return {
    async loadConfig() {
      const raw =
        (await getObjectText(`${prefix}docs.json`)) ?? (await getObjectText(`${prefix}mint.json`));
      if (!raw) throw new Error(`Site ${siteId} has no synced config`);
      const { config, warnings } = parseDocsConfig(JSON.parse(raw));
      for (const w of warnings) console.warn(`docs.json: ${w}`);
      return config;
    },
    async loadPage(slug) {
      const normalized = slug === "" || slug === "/" ? "index" : slug;
      for (const ext of PAGE_EXTS) {
        const raw = await getObjectText(`${prefix}${normalized}${ext}`);
        if (raw !== null) return parsePage(slug, raw);
      }
      return null;
    },
    async listPageSlugs() {
      const keys = await listKeys(prefix);
      return keys
        .filter((k) => PAGE_EXTS.some((e) => k.endsWith(e)))
        .map((k) => k.slice(prefix.length).replace(/\.mdx?$/, ""))
        .map((s) => (s === "index" ? "" : s));
    },
  };
}

/** Has this site been synced to storage yet? */
export async function isSynced(siteId: string): Promise<boolean> {
  const prefix = `sites/${siteId}/`;
  return (
    (await getObjectText(`${prefix}docs.json`)) !== null ||
    (await getObjectText(`${prefix}mint.json`)) !== null
  );
}
