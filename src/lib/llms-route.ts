import "server-only";
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { requestContentSource } from "./request-source";
import { contentContext } from "./content";
import { getSiteByHost } from "./tenant";
import { detectAgent } from "./ua-detect";
import { logEvent } from "./track";
import { renderLlmsTxt } from "./llms";

/**
 * Serve /llms.txt (and /llms-full.txt) for the tenant in scope, and log the visit as
 * agent traffic (SPEC §10.1). Resolves the tenant content source from the request
 * (host + x-papervine-site header, set by middleware), falling back to the apex/preview
 * default source when there's no tenant. The render runs inside `contentContext` so
 * config/pages read from the right repo.
 */
export async function handleLlmsRequest(req: NextRequest, full: boolean): Promise<Response> {
  const host = req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const origin = host ? `${proto}://${host}` : "";

  const src = await requestContentSource();
  const render = () => renderLlmsTxt(origin, full);
  let body: string;
  try {
    body = src ? await contentContext.run(src, render) : await render();
  } catch {
    return new Response("Not found", { status: 404 });
  }

  // Record the visit by agent name (fire-and-forget). llms.txt is an agent surface, so
  // we log known agents and generic non-browser clients; a per-fetch session id makes
  // each retrieval one "visit". No-op on the apex/preview host (no tenant site).
  const { isAgent, name } = detectAgent(req.headers.get("user-agent"));
  if (isAgent) {
    const site = await getSiteByHost(host);
    if (site) {
      void logEvent({
        siteId: site.id,
        type: "page_view",
        source: "agent",
        agent: name,
        path: full ? "/llms-full.txt" : "/llms.txt",
        sessionId: randomUUID(),
      });
    }
  }

  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
