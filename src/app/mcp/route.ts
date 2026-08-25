import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { headers } from "next/headers";
import { registerDocsTools } from "@papervine/renderer/lib/mcp-tools";
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
import { logEvent } from "@/lib/track";

/**
 * Generated MCP server for this docs site (SPEC §8.5). Exposes the docs as Model Context
 * Protocol tools so external AI clients (Claude, Cursor, …) can search and read them live. Same
 * capabilities as the in-app assistant (`docs-tools.ts`), a second transport.
 *
 * Streamable HTTP, stateless (no Redis). Connect a client to `https://<docs-host>/mcp`.
 *
 * The tools themselves are registered by `registerDocsTools` in the renderer, shared with the
 * CLI's `/mcp` route — the names, descriptions and schemas are a prompt an external client reads,
 * and two copies of a prompt become two different products. What stays here is what only the
 * hosted deployment has: tenant routing, the anonymous reader gate, and agent analytics.
 *
 * Transport is the SDK's **Web-standard** Streamable HTTP transport, whose `handleRequest` takes a
 * `Request` and returns a `Response` — a route handler's exact contract. This replaced
 * `mcp-handler`, which exists only to bridge the SDK's Node-`IncomingMessage` transport to a
 * Fetch handler, and which declares `redis` as a runtime dependency and imports it eagerly. With
 * the Web-standard transport there is nothing to bridge, so that dependency (and its 4MB Redis
 * client) left the tree.
 */
export const dynamic = "force-dynamic";

async function handle(req: Request): Promise<Response> {
  // Resolve the tenant once per request. On the apex/preview host there is no tenant: `src` is
  // null (tools fall back to the default content source) and `site` is null (logging no-ops), so
  // this stays correct in single-repo preview mode.
  const h = await headers();
  const src = await requestContentSource();
  const site = await getSiteByHost(h.get("host"));
  // External agents carry no reader session, so on a gated site (SPEC §11.2) the MCP server
  // exposes only the public/un-gated subset — a group-gated page is invisible to search,
  // read_page and list_pages, exactly as it is to an anonymous browser. (Per-reader authenticated
  // MCP — passing a reader token over MCP — is a separate follow-up.) On a non-gated site this is
  // ALLOW_ALL, so behaviour there is unchanged.
  const access = await requestReaderAccess(undefined, { anonymous: true });
  // Version key so search_docs reuses the cached index across tool calls (live content; SPEC §6).
  const indexKey = await requestSearchIndexKey();
  // Anything reaching /mcp is an agent; name it when we can, else "Other".
  const agentName = detectAgent(h.get("user-agent")).name || "Other";
  // Stable per-client id so a connection's many tool calls count as ONE visitor, not one per
  // call — the server is stateless, so a fresh UUID here would inflate "Agent Visitors" to equal
  // page views (SPEC §10.1, see agent-session.ts).
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

  const server = new McpServer(
    { name: "Papervine Docs", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  await registerDocsTools(server, {
    run,
    hooks: {
      // Fire-and-forget, as with the assistant's hooks: a failure to log must never take down a
      // tool call an agent is already waiting on.
      onSearch: (query) => {
        if (site) {
          void logEvent({
            siteId: site.id,
            type: "search",
            source: "agent",
            agent: agentName,
            sessionId,
            query,
          });
        }
      },
      onReadPage: (path) => {
        if (site) {
          void logEvent({
            siteId: site.id,
            type: "page_view",
            source: "agent",
            agent: agentName,
            sessionId,
            path,
          });
        }
      },
    },
  });

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    await server.close();
  }
}

export { handle as GET, handle as POST, handle as DELETE };
