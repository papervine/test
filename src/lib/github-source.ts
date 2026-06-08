import "server-only";
import { parseDocsConfig } from "./config";
import { parsePage, PAGE_EXTS, type ContentSource } from "./content";

// Per-tenant content source backed by a public GitHub repo. Reads file content
// from raw.githubusercontent.com (CDN-served, not subject to the REST API's
// 60 req/hr unauthenticated limit) — important because rendering one page fetches
// every nav slug for its sidebar title. The GitHub App / compiled-bundle source
// (SPEC §3) replaces this for private repos and performance.
export function githubSource(owner: string, name: string, branch: string): ContentSource {
  const rawBase = `https://raw.githubusercontent.com/${owner}/${name}/${branch}`;

  async function fetchText(filePath: string): Promise<string | null> {
    const res = await fetch(`${rawBase}/${filePath}`, {
      // Re-fetch at most every 60s; a manual sync / webhook will bust this later.
      next: { revalidate: 60 },
    });
    return res.ok ? res.text() : null;
  }

  return {
    async loadConfig() {
      const raw = (await fetchText("docs.json")) ?? (await fetchText("mint.json"));
      if (!raw) throw new Error(`No docs.json/mint.json in ${owner}/${name}@${branch}`);
      const { config, warnings } = parseDocsConfig(JSON.parse(raw));
      for (const w of warnings) console.warn(`docs.json: ${w}`);
      return config;
    },
    async loadPage(slug) {
      const normalized = slug === "" || slug === "/" ? "index" : slug;
      for (const ext of PAGE_EXTS) {
        const raw = await fetchText(`${normalized}${ext}`);
        if (raw !== null) return parsePage(slug, raw);
      }
      return null;
    },
    // Tenant routes render dynamically (content lives over the network), so we don't
    // pre-enumerate slugs for static generation.
    async listPageSlugs() {
      return [];
    },
  };
}
