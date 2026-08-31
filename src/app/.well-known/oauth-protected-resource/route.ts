import { protectedResourceMetadata, requestOrigin } from "@/lib/mcp-oauth-metadata";

/**
 * OAuth 2.0 protected-resource metadata (RFC 9728) for the authoring MCP (SPEC §9.2/§11).
 *
 * The first hop of the flow: `/authoring/mcp` answers an unauthenticated request with
 * `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource"`, the
 * client fetches this, and this names the authorization server it should then discover.
 *
 * A ROOT route on the app host, so it needs a middleware bypass like the Sentry tunnel and the
 * MCP endpoint itself — without one it is rewritten to `/app/.well-known/…`, which nothing
 * backs, and the flow dead-ends at a 404 the client reports as "this server doesn't support
 * authorization". See `WELL_KNOWN_OAUTH` in src/middleware.ts.
 */
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return Response.json(protectedResourceMetadata(requestOrigin(req)), {
    // Discovery is read cross-origin by clients that have no credential yet, and the documents
    // are public by design (endpoint URLs and supported grant types).
    headers: { "Access-Control-Allow-Origin": "*" },
  });
}
