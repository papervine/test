import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { cache } from "react";
import matter from "gray-matter";
import { parseDocsConfig, type DocsConfig } from "./config";

export type PageFrontmatter = {
  title?: string;
  description?: string;
  icon?: string;
  sidebarTitle?: string; // nav label override (GAP-REPORT §3)
  hidden?: boolean; // reachable by URL, but omitted from the sidebar
  noindex?: boolean; // exclude from search/SEO
};

export type Page = {
  slug: string;
  frontmatter: PageFrontmatter;
  body: string; // raw MDX, compiled downstream
};

/**
 * A content source backs loadConfig/loadPage/listPageSlugs. The default is a local
 * folder (M0/single-tenant). Multi-tenant rendering (SPEC §2) swaps in a per-tenant
 * source (GitHub today, compiled bundles later) via `contentContext.run(source, …)`
 * — set once at the top of the tenant route so everything inside, including buildNav
 * (which calls loadPage for sidebar titles), reads from it without threading a source
 * argument through every signature.
 */
export type ContentSource = {
  loadConfig(): Promise<DocsConfig>;
  loadPage(slug: string): Promise<Page | null>;
  listPageSlugs(): Promise<string[]>;
};

export const contentContext = new AsyncLocalStorage<ContentSource>();

/** Page file extensions we serve, in resolution priority order. The incumbent ships both. */
export const PAGE_EXTS = [".mdx", ".md"];

/** Parse raw file text into a Page; malformed frontmatter degrades to body-only (GAP-REPORT §S1). */
export function parsePage(slug: string, raw: string): Page {
  let data: Record<string, unknown> = {};
  let content = raw;
  try {
    const parsed = matter(raw);
    data = parsed.data;
    content = parsed.content;
  } catch (err) {
    console.warn(`Frontmatter parse failed for ${slug}: ${(err as Error).message}`);
  }
  return { slug: slug === "/" ? "" : slug, frontmatter: data as PageFrontmatter, body: content };
}

/** Local-folder content source (default). Defaults to ./content; PAPERVINE_CONTENT overrides. */
export function fsSource(dir: string): ContentSource {
  const CONTENT_DIR = path.resolve(dir);

  async function resolveSlugToFile(slug: string): Promise<string | null> {
    const normalized = slug === "" || slug === "/" ? "index" : slug;
    for (const ext of PAGE_EXTS) {
      const target = path.normalize(path.join(CONTENT_DIR, `${normalized}${ext}`));
      if (!target.startsWith(CONTENT_DIR + path.sep)) return null; // no traversal outside dir
      try {
        await fs.access(target);
        return target;
      } catch {
        // try next extension
      }
    }
    return null;
  }

  return {
    async loadConfig() {
      const raw = await fs.readFile(path.join(CONTENT_DIR, "docs.json"), "utf8");
      const { config, warnings } = parseDocsConfig(JSON.parse(raw));
      for (const w of warnings) console.warn(`docs.json: ${w}`);
      return config;
    },
    async loadPage(slug) {
      const file = await resolveSlugToFile(slug);
      if (!file) return null;
      return parsePage(slug, await fs.readFile(file, "utf8"));
    },
    async listPageSlugs() {
      const slugs: string[] = [];
      async function walk(dir: string) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) await walk(full);
          else if (PAGE_EXTS.some((ext) => entry.name.endsWith(ext))) {
            const rel = path.relative(CONTENT_DIR, full).replace(/\.mdx?$/, "");
            slugs.push(rel === "index" ? "" : rel);
          }
        }
      }
      await walk(CONTENT_DIR);
      return slugs;
    },
  };
}

const defaultSource = fsSource(process.env.PAPERVINE_CONTENT ?? path.join(process.cwd(), "content"));

/** The active source: a tenant source if one is in scope, else the local default. */
function source(): ContentSource {
  return contentContext.getStore() ?? defaultSource;
}

// Public API — cached per request, keyed by args. Delegates to the active source.
export const loadConfig = cache((): Promise<DocsConfig> => source().loadConfig());
export const loadPage = cache((slug: string): Promise<Page | null> => source().loadPage(slug));
export const listPageSlugs = cache((): Promise<string[]> => source().listPageSlugs());
