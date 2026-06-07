import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { cache } from "react";
import matter from "gray-matter";
import { parseDocsConfig, type DocsConfig } from "./config";

/**
 * M0 content source: a local folder holding docs.json + MDX files.
 * Defaults to ./content, but `DOCBOT_CONTENT` overrides it so the renderer can
 * preview any docs repo (this is what the `docbot dev` CLI sets). At M2 this
 * becomes a per-tenant store reading compiled bundles from object storage — but
 * the interface (loadConfig / loadPage) stays the same.
 */
const CONTENT_DIR = path.resolve(
  process.env.DOCBOT_CONTENT ?? path.join(process.cwd(), "content"),
);

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

/** Page file extensions we serve, in resolution priority order. The incumbent ships both. */
const PAGE_EXTS = [".mdx", ".md"];

/** Load and validate docs.json. Cached per request; warnings logged once. */
export const loadConfig = cache(async (): Promise<DocsConfig> => {
  const raw = await fs.readFile(path.join(CONTENT_DIR, "docs.json"), "utf8");
  const { config, warnings } = parseDocsConfig(JSON.parse(raw));
  for (const w of warnings) console.warn(`docs.json: ${w}`);
  return config;
});

/** Resolve a slug ("guides/intro", "" for home) to a page file, trying .mdx then .md. */
async function resolveSlugToFile(slug: string): Promise<string | null> {
  const normalized = slug === "" || slug === "/" ? "index" : slug;
  for (const ext of PAGE_EXTS) {
    // Prevent path traversal outside CONTENT_DIR.
    const target = path.normalize(path.join(CONTENT_DIR, `${normalized}${ext}`));
    if (!target.startsWith(CONTENT_DIR + path.sep)) return null;
    try {
      await fs.access(target);
      return target;
    } catch {
      // try next extension
    }
  }
  return null;
}

/** Load a single page by slug. Returns null if the file doesn't exist. */
export const loadPage = cache(async (slug: string): Promise<Page | null> => {
  const file = await resolveSlugToFile(slug);
  if (!file) return null;
  const raw = await fs.readFile(file, "utf8");

  // Malformed frontmatter YAML must not crash the page (GAP-REPORT §S1) — fall
  // back to treating the whole file as body with no frontmatter.
  let data: Record<string, unknown> = {};
  let content = raw;
  try {
    const parsed = matter(raw);
    data = parsed.data;
    content = parsed.content;
  } catch (err) {
    console.warn(`Frontmatter parse failed for ${slug}: ${(err as Error).message}`);
  }

  return {
    slug: slug === "/" ? "" : slug,
    frontmatter: data as PageFrontmatter,
    body: content,
  };
});

/** Walk the content dir for all page slugs (.mdx + .md). */
export const listPageSlugs = cache(async (): Promise<string[]> => {
  const slugs: string[] = [];
  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (PAGE_EXTS.some((ext) => entry.name.endsWith(ext))) {
        const rel = path.relative(CONTENT_DIR, full).replace(/\.mdx?$/, "");
        slugs.push(rel === "index" ? "" : rel);
      }
    }
  }
  await walk(CONTENT_DIR);
  return slugs;
});
