import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { headers } from "next/headers";
import { searchDocs, readPage, listPages, searchApi, apiEnabled } from "@/lib/docs-tools";
import { contentContext } from "@papervine/renderer/lib/content";
import {
  requestContentSource,
  requestReaderAccess,
  requestSearchIndexKey,
} from "@/lib/request-source";
import { withReaderAccess } from "@/lib/reader-access";
import { withSearchIndexKey } from "@/lib/search";
import { getSiteByHost } from "@/lib/tenant";
import { detectAgent } from "@/lib/ua-detect";
import { agentSessionId, firstForwardedIp } from "@/lib/agent-session";
import { logEvent, type EventType } from "@/lib/track";

/**
 * Generated MCP server for this docs site (SPEC §8.5) — the incumbent "MCP for your
 * docs" feature. Exposes the docs as Model Context Protocol tools so external AI
 * clients (Claude, Cursor, …) can search and read the docs live. Same capabilities
 * as the in-app assistant (`docs-tools.ts`), a second transport.
 *
 * Streamable HTTP, stateless (no Redis). Connect a client to `https://<docs-host>/mcp`.
 *
 * Tenant-routed + instrumented (SPEC §10.1): each connection resolves the tenant
 * content source (so tools read the right repo on a tenant host) and logs agent
 * analytics — search_docs → an "MCP Searches" event, read_page → an agent page view.
 */
const json = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

const handler = createMcpHandler(
  async (server) => {
    // Resolve the tenant once per connection. On the apex/preview host there's no
    // tenant: `src` is null (tools fall back to the default content source) and `site`
    // is null (logging no-ops) — so this stays correct in single-repo preview mode.
    const h = await headers();
    const src = await requestContentSource();
    const site = await getSiteByHost(h.get("host"));
    // External agents carry no reader session, so on a gated site (SPEC §11.2) the MCP server
    // exposes only the public/un-gated subset — a group-gated page is invisible to search,
    // read_page, and list_pages, exactly as it is to an anonymous browser. (Per-reader
    // authenticated MCP — passing a reader token over MCP — is a separate follow-up.) On a
    // non-gated site this is ALLOW_ALL, so behavior there is unchanged.
    const access = await requestReaderAccess(undefined, { anonymous: true });
    // Version key so search_docs reuses the cached index across tool calls (live content; SPEC §6).
    const indexKey = await requestSearchIndexKey();
    // Anything reaching /mcp is an agent; name it when we can, else "Other".
    const agentName = detectAgent(h.get("user-agent")).name || "Other";
    // Stable per-client id so a connection's many tool calls count as ONE visitor,
    // not one-per-call — the server is stateless, so a fresh UUID here would inflate
    // "Agent Visitors" to equal page views (SPEC §10.1, see agent-session.ts).
    const sessionId = agentSessionId({
      mcpSessionId: h.get("mcp-session-id"),
      agent: agentName,
      userAgent: h.get("user-agent"),
      ip: firstForwardedIp(h.get("x-forwarded-for")) ?? h.get("x-real-ip"),
    });

    const run = <T>(fn: () => Promise<T>): Promise<T> => {
      const inner = (): Promise<T> =>
        Promise.resolve(withReaderAccess(access, () => withSearchIndexKey(indexKey, fn)));
      return src ? contentContext.run(src, inner) : inner();
    };

    const track = (type: EventType, fields: { query?: string; path?: string }) => {
      if (!site) return;
      void logEvent({ siteId: site.id, type, source: "agent", agent: agentName, sessionId, ...fields });
    };

    server.tool(
      "search_docs",
      "Full-text search this documentation. Returns the most relevant page sections with titles, hrefs (with #anchors), and snippets. Call this first for most questions.",
      { query: z.string().describe("Keywords to search for in the docs.") },
      async ({ query }) => {
        track("search", { query });
        return run(async () => json(await searchDocs(query)));
      },
    );

    server.tool(
      "read_page",
      "Read the full Markdown content of a documentation page by slug (e.g. 'guides/intro'). Use after search_docs when a snippet isn't enough.",
      { slug: z.string().describe("Page slug, with or without leading slash.") },
      async ({ slug }) => {
        track("page_view", { path: "/" + slug.replace(/^\//, "") });
        return run(async () => json(await readPage(slug)));
      },
    );

    server.tool(
      "list_pages",
      "List every documentation page (title + href) to understand what topics exist.",
      {},
      async () => run(async () => json(await listPages())),
    );

    // Only expose the API tool when the site has an OpenAPI-backed reference.
    if (await run(() => apiEnabled())) {
      server.tool(
        "search_api",
        "Search the API reference (OpenAPI operations) by keyword. Returns method, path, summary, and the endpoint page href.",
        { query: z.string().describe("Keywords, e.g. 'create user' or 'auth'.") },
        async ({ query }) => run(async () => json(await searchApi(query))),
      );
    }
  },
  { serverInfo: { name: "Papervine Docs", version: "0.1.0" } },
  { basePath: "" },
);

export { handler as GET, handler as POST, handler as DELETE };
