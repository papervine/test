import "server-only";
import { tool } from "ai";
import { z } from "zod";
import type { ToolSet } from "ai";
import { proxy } from "../nango";

/**
 * Notion read tools for the agent (SPEC §10.2 connector tool layer).
 *
 * Read-only by construction, like every connector: search and read, nothing that writes.
 *
 * Notion is a bigger translation job than Drive. Drive hands back a file; Notion hands
 * back a *tree of typed blocks* with text split into "rich text" runs, and no endpoint
 * that returns a page as prose. So the work here is flattening that into something a
 * model can actually read — which is the honest cost of a connector, and the reason this
 * is hand-written rather than rented (the §10.2 ADR).
 */

// Every Notion request must carry a version; the API refuses without one. Pinned rather
// than floating: a new version can change response shapes, and a connector that silently
// starts returning something else is worse than one that needs a deliberate bump.
const NOTION_VERSION = "2022-06-28";
const HEADERS = { "Notion-Version": NOTION_VERSION };

// A page's worth of blocks. Notion paginates at 100; one request is plenty for the
// question "what does this page say", and going deeper costs a round trip per level.
const PAGE_SIZE = 100;
const MAX_CHARS = 20_000;

type RichText = { plain_text?: string };
type Block = {
  id: string;
  type: string;
  has_children?: boolean;
  [key: string]: unknown;
};
type NotionPage = {
  id: string;
  url?: string;
  properties?: Record<string, { type?: string; title?: RichText[] }>;
  parent?: { type?: string };
};

/** Runs of rich text → a plain string. Notion splits on every formatting change, so a
 * single sentence routinely arrives as five runs. */
function plain(rich: unknown): string {
  return Array.isArray(rich)
    ? (rich as RichText[]).map((r) => r?.plain_text ?? "").join("")
    : "";
}

/**
 * A page's title. It lives in whichever property has type "title" — the KEY varies by
 * database ("Name", "Task", anything the author chose), so it can't be looked up by name.
 */
function pageTitle(page: NotionPage): string {
  const props = Object.values(page.properties ?? {});
  const titleProp = props.find((p) => p?.type === "title");
  return plain(titleProp?.title) || "Untitled";
}

/**
 * One block → one line of text, keeping the structure that carries meaning: headings stay
 * headings, list items stay list items, checkboxes keep their state. Markdown, because
 * that's what the model reads best and what the docs it's helping write are made of.
 */
function blockToText(block: Block): string {
  const body = (block[block.type] ?? {}) as { rich_text?: unknown; checked?: boolean; language?: string; url?: string };
  const text = plain(body.rich_text);

  switch (block.type) {
    case "heading_1":
      return `# ${text}`;
    case "heading_2":
      return `## ${text}`;
    case "heading_3":
      return `### ${text}`;
    case "bulleted_list_item":
      return `- ${text}`;
    case "numbered_list_item":
      return `1. ${text}`;
    case "to_do":
      return `- [${body.checked ? "x" : " "}] ${text}`;
    case "quote":
      return `> ${text}`;
    case "callout":
      return `> ${text}`;
    case "code":
      return `\`\`\`${body.language ?? ""}\n${text}\n\`\`\``;
    case "divider":
      return "---";
    case "child_page":
      return `[sub-page] ${(block.child_page as { title?: string })?.title ?? ""}`;
    case "child_database":
      return `[database] ${(block.child_database as { title?: string })?.title ?? ""}`;
    // Blocks whose whole content is a link or an embed: the URL is the information.
    case "bookmark":
    case "embed":
    case "link_preview":
      return body.url ? `[link] ${body.url}` : "";
    // Images, videos, files, unsupported/new block types: no text to give, and a label
    // for each would be noise. Dropped rather than rendered as an empty line.
    default:
      return text;
  }
}

export function notionTools(organizationId: string): ToolSet {
  const call = <T>(
    endpoint: string,
    opts: { method?: "GET" | "POST"; params?: Record<string, string | number | boolean>; data?: unknown } = {},
  ) =>
    proxy<T>({
      organizationId,
      provider: "notion",
      endpoint,
      headers: HEADERS,
      ...opts,
    });

  return {
    search_notion: tool({
      description:
        "Search the connected Notion workspace for pages by keyword. Returns page titles " +
        "and links. Use before read_notion_page to find the right page.",
      inputSchema: z.object({
        query: z.string().describe("Keywords to search page titles and content for."),
        limit: z.number().int().min(1).max(25).optional().describe("Max results (default 10)."),
      }),
      execute: async ({ query, limit }) => {
        const res = await call<{ results?: NotionPage[] }>("/v1/search", {
          method: "POST",
          data: {
            query,
            // Pages only. Databases come back from the same endpoint and can't be read by
            // read_notion_page, so offering them would hand the model dead ids.
            filter: { property: "object", value: "page" },
            page_size: limit ?? 10,
          },
        });
        if ("error" in res) return { error: res.error };

        const pages = (res.data.results ?? []).map((p) => ({
          id: p.id,
          title: pageTitle(p),
          url: p.url,
        }));
        return pages.length
          ? { pages }
          : {
              pages: [],
              // Notion only searches what the connected integration was explicitly shared
              // with — an empty result usually means nobody granted it access, not that
              // the workspace is empty. Say so, or the agent reports "no such page" about
              // a page that exists.
              note:
                "No matching pages. Note that Notion only returns pages explicitly shared " +
                "with the connected integration.",
            };
      },
    }),

    read_notion_page: tool({
      description:
        "Read the text of a Notion page by id (from search_notion). Returns the page " +
        "content as Markdown.",
      inputSchema: z.object({
        pageId: z.string().describe("The Notion page id returned by search_notion."),
      }),
      execute: async ({ pageId }) => {
        const id = encodeURIComponent(pageId);
        // Metadata and content are two calls: /pages carries the title and URL, /blocks
        // carries the body. Notion has no endpoint that returns both.
        const meta = await call<NotionPage>(`/v1/pages/${id}`);
        if ("error" in meta) return { error: meta.error };

        const blocks = await call<{ results?: Block[]; has_more?: boolean }>(
          `/v1/blocks/${id}/children`,
          { params: { page_size: PAGE_SIZE } },
        );
        if ("error" in blocks) return { error: blocks.error };

        const lines = (blocks.data.results ?? []).map(blockToText).filter(Boolean);
        const content = lines.join("\n");
        const truncated = content.length > MAX_CHARS;
        return {
          title: pageTitle(meta.data),
          url: meta.data.url,
          content: truncated ? content.slice(0, MAX_CHARS) : content,
          // Two different kinds of "there's more", and the model should say which:
          // more blocks on the page, or a page longer than we're willing to send.
          ...(truncated ? { truncated: true, note: "Content truncated." } : {}),
          ...(blocks.data.has_more
            ? { note: "This page has more blocks than were read." }
            : {}),
        };
      },
    }),
  };
}
