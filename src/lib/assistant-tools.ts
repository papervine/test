import "server-only";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { runSearch } from "./search";
import { loadPage, loadConfig } from "./content";
import { buildNav, type NavLeaf, type NavNode } from "./nav";
import { loadApiCatalog } from "./openapi";

/**
 * The assistant's tool layer (SPEC §8.1). Agentic retrieval: Claude decides which
 * of these to call, and how often, to answer a question. Each is a thin wrapper over
 * a capability the renderer already has — the same set a generated read-MCP would
 * expose (SPEC §8.5), so this is one implementation behind two transports.
 */
export const assistantTools: ToolSet = {
  searchDocs: tool({
    description:
      "Full-text search the documentation. Returns the most relevant page sections with titles, hrefs (with #anchors), and snippets. Call this first for most questions.",
    inputSchema: z.object({
      query: z.string().describe("Keywords to search for in the docs."),
    }),
    execute: async ({ query }) => {
      const hits = await runSearch(query);
      return hits.slice(0, 8).map((h) => ({
        title: h.title,
        heading: h.heading,
        href: h.href,
        snippet: h.snippet,
      }));
    },
  }),

  readPage: tool({
    description:
      "Read the full Markdown content of a documentation page by slug (e.g. 'guides/intro'). Use after searchDocs when a snippet isn't enough to answer.",
    inputSchema: z.object({
      slug: z.string().describe("Page slug, with or without leading slash."),
    }),
    execute: async ({ slug }) => {
      const page = await loadPage(slug.replace(/^\//, ""));
      if (!page) return { error: `No page found for slug "${slug}".` };
      return {
        title: page.frontmatter.title,
        description: page.frontmatter.description,
        href: "/" + slug.replace(/^\//, ""),
        body: page.body.slice(0, 8000),
      };
    },
  }),

  listPages: tool({
    description:
      "List every documentation page (title + href) to understand what topics exist. Use when a search comes up empty or to orient.",
    inputSchema: z.object({}),
    execute: async () => {
      const sections = await buildNav(await loadConfig());
      const out: { title: string; href: string }[] = [];
      const walk = (nodes: (NavLeaf | NavNode)[]) => {
        for (const n of nodes) {
          if ("href" in n) out.push({ title: n.title, href: n.href });
          else walk(n.items);
        }
      };
      for (const s of sections) walk(s.nodes);
      return out;
    },
  }),

  searchApi: tool({
    description:
      "Search the API reference (OpenAPI operations) by keyword. Returns method, path, summary, and the endpoint page href.",
    inputSchema: z.object({
      query: z.string().describe("Keywords, e.g. 'create user' or 'auth'."),
    }),
    execute: async ({ query }) => {
      const catalog = await loadApiCatalog(await loadConfig());
      const q = query.toLowerCase();
      return [...catalog.values()]
        .filter((op) =>
          `${op.method} ${op.path} ${op.summary ?? ""} ${op.description ?? ""}`
            .toLowerCase()
            .includes(q),
        )
        .slice(0, 10)
        .map((op) => ({
          method: op.method,
          path: op.path,
          summary: op.summary,
          href: "/" + op.slug,
        }));
    },
  }),
};
