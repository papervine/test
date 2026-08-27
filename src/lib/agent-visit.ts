import "server-only";
import { type NextRequest } from "next/server";
import { getSiteByHost } from "./tenant";
import { detectAgent } from "./ua-detect";
import { agentSessionId, firstForwardedIp } from "./agent-session";
import { logEvent } from "./track";

/**
 * Record a fetch of one of the AI-facing surfaces (`/llms.txt`, `/llms-full.txt`, a page's
 * `.md` twin) as agent traffic (SPEC §10.1). Fire-and-forget, and a no-op on the
 * apex/preview host where there's no tenant site to attribute it to.
 *
 * These surfaces have no browser session, so attribution leans on UA detection: we log
 * known agents by name plus generic non-browser clients, and derive a **stable** per-client
 * session id (never a per-fetch UUID) so "Agent Visitors" stays a distinct-client count
 * rather than a request count — the same derivation the MCP tools use.
 */
export function logAgentVisit(req: NextRequest, path: string): void {
  const { isAgent, name } = detectAgent(req.headers.get("user-agent"));
  if (!isAgent) return;
  void (async () => {
    const site = await getSiteByHost(req.headers.get("host"));
    if (!site) return;
    await logEvent({
      siteId: site.id,
      type: "page_view",
      source: "agent",
      agent: name,
      path,
      sessionId: agentSessionId({
        mcpSessionId: req.headers.get("mcp-session-id"),
        agent: name,
        userAgent: req.headers.get("user-agent"),
        ip: firstForwardedIp(req.headers.get("x-forwarded-for")) ?? req.headers.get("x-real-ip"),
      }),
    });
  })();
}
