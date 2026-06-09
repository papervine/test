import "server-only";
import { cache } from "react";
import { create, insertMultiple, search as oramaSearch } from "@orama/orama";
import { listPageSlugs, loadPage, loadConfig } from "./content";
import { buildNav, findGroupLabel } from "./nav";

/**
 * Full-text search index (SPEC.md §6). Each docs page is split into heading
 * sections so a hit can jump straight to the relevant anchor — like the incumbent.
 *
 * The index is built from the same content source the renderer reads, so at M2
 * this builder runs once at sync time per tenant; today it's memoized per request
 * (React `cache`) so it stays fresh as you edit docs in `papervine dev`.
 */
const schema = {
  title: "string",
  section: "string",
  heading: "string",
  content: "string",
  href: "string",
} as const;

export type SearchHit = {
  title: string;
  section: string;
  heading: string;
  href: string;
  snippet: string;
};

function titleFromSlug(slug: string): string {
  const last = slug.split("/").pop() || slug || "Home";
  return last
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Same slug algorithm as the TOC, so hrefs match rendered heading ids. */
function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

/** Reduce MDX/Markdown to plain, searchable text. */
function stripMarkdown(s: string): string {
  return s
    .replace(/^import\s.*$/gm, " ") // mdx imports
    .replace(/<[^>]+>/g, " ") // JSX / HTML tags
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links → link text
    .replace(/[#>*_`~|]/g, " ") // markdown punctuation
    .replace(/\s+/g, " ")
    .trim();
}

type Section = { heading: string; id: string; lines: string[] };

/** Split a page body into sections at H2/H3 boundaries (code fences ignored). */
function splitSections(body: string): Section[] {
  const sections: Section[] = [];
  let current: Section = { heading: "", id: "", lines: [] };
  let inFence = false;
  for (const line of body.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    const match = !inFence && /^(#{2,3})\s+(.+?)\s*$/.exec(line);
    if (match) {
      if (current.heading || current.lines.length) sections.push(current);
      const heading = match[2].replace(/[*_`]/g, "");
      current = { heading, id: slugifyHeading(heading), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  sections.push(current);
  return sections;
}

const buildIndex = cache(async () => {
  const db = await create({ schema });
  const config = await loadConfig();
  const nav = await buildNav(config);
  const slugs = await listPageSlugs();

  const docs: Array<Record<string, string>> = [];
  for (const slug of slugs) {
    const page = await loadPage(slug);
    if (!page || page.frontmatter.hidden || page.frontmatter.noindex) continue;

    const baseHref = "/" + (slug || "index");
    const title = page.frontmatter.title ?? titleFromSlug(slug);
    const section = findGroupLabel(nav, baseHref) ?? "";

    for (const part of splitSections(page.body)) {
      const text = stripMarkdown(part.lines.join("\n"));
      if (part.heading) {
        docs.push({ title, section, heading: part.heading, content: text, href: `${baseHref}#${part.id}` });
      } else {
        // Intro section carries the page title + description so a page is findable
        // by name even when its first prose is thin.
        const content = [page.frontmatter.description, text].filter(Boolean).join(" ");
        docs.push({ title, section, heading: "", content, href: baseHref });
      }
    }
  }

  await insertMultiple(db, docs);
  return db;
});

/** Build a short snippet centered on the first matched term. */
function makeSnippet(content: string, term: string, len = 140): string {
  if (!content) return "";
  const lower = content.toLowerCase();
  const first = term.toLowerCase().split(/\s+/).find((t) => lower.includes(t));
  const at = first ? lower.indexOf(first) : 0;
  const start = Math.max(0, at - 50);
  const slice = content.slice(start, start + len).trim();
  return (start > 0 ? "…" : "") + slice + (start + len < content.length ? "…" : "");
}

export async function runSearch(term: string, limit = 8): Promise<SearchHit[]> {
  if (!term.trim()) return [];
  const db = await buildIndex();
  const res = await oramaSearch(db, {
    term,
    properties: ["title", "heading", "content"],
    boost: { title: 4, heading: 2 },
    tolerance: 1, // typo tolerance
    limit,
  });
  return res.hits.map((h) => {
    const d = h.document as Record<string, string>;
    return {
      title: d.title,
      section: d.section,
      heading: d.heading,
      href: d.href,
      snippet: makeSnippet(d.content, term),
    };
  });
}
