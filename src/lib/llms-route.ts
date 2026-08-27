import "server-only";
import { type NextRequest } from "next/server";
import { requestContentSource, requestReaderAccess } from "./request-source";
import { withReaderAccess } from "./reader-access";
import { contentContext } from "@papervine/renderer/lib/content";
import { logAgentVisit } from "./agent-visit";
import { setLlmsDiscoveryHeaders } from "@papervine/renderer/lib/llms-discovery";
import { renderLlmsTxt } from "@papervine/renderer/lib/llms";

/** `setLlmsDiscoveryHeaders`, as an expression so it can wrap a `new Headers(...)` literal. */
export function llmsDiscoveryHeaders(headers: Headers): Headers {
  setLlmsDiscoveryHeaders(headers);
  return headers;
}

/**
 * Serve /llms.txt (and /llms-full.txt) for the tenant in scope, and log the visit as agent
 * traffic (SPEC §10.1). Resolves the tenant content source from the request (host +
 * x-papervine-site header, set by middleware), falling back to the apex/preview default
 * source when there's no tenant. The render runs inside `contentContext` so config/pages
 * read from the right repo.
 */
export async function handleLlmsRequest(req: NextRequest, full: boolean): Promise<Response> {
  const host = req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const origin = host ? `${proto}://${host}` : "";

  const src = await requestContentSource();
  // llms.txt is an agent surface with no reader session (like MCP), so on a gated site it
  // lists/inlines only the public subset — gated pages never leak through the corpus dump
  // (SPEC §11.2). The whole render flows through the now-gated `listPages`.
  const access = await requestReaderAccess(undefined, { anonymous: true });
  const render = () => withReaderAccess(access, () => renderLlmsTxt(origin, full));
  let body: string;
  try {
    body = src ? await contentContext.run(src, render) : await render();
  } catch {
    return new Response("Not found", { status: 404 });
  }

  logAgentVisit(req, full ? "/llms-full.txt" : "/llms.txt");

  const headers = llmsDiscoveryHeaders(
    new Headers({
      "content-type": "text/plain; charset=utf-8",
      // The response is identical for every client (it's always the anonymous, public
      // subset), and building it now walks every page for its description — so let a CDN
      // absorb the repeat fetches that a crawl of this surface produces. `markSiteLive`
      // bumps the site row on publish, but this route is `force-dynamic` and outside the
      // content cache, so the ceiling here is time, not a version key.
      "cache-control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    }),
  );
  return new Response(body, { headers });
}
