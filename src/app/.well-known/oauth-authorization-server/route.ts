import { authorizationServerMetadata, requestOrigin } from "@/lib/mcp-oauth-metadata";

/**
 * OAuth 2.1 authorization-server metadata (RFC 8414) for the authoring MCP (SPEC §9.2/§11).
 *
 * An MCP client that gets a 401 from `/authoring/mcp` reads the `WWW-Authenticate` header,
 * fetches `/.well-known/oauth-protected-resource`, and lands here to learn the authorize,
 * token and registration endpoints — all Better Auth's, under `/api/auth/mcp/*`.
 *
 * Same ROOT-route caveat as its sibling: bypassed in the middleware, or the app host rewrites
 * it onto `/app/*` and the flow ends before it starts.
 */
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return Response.json(authorizationServerMetadata(requestOrigin(req)), {
    headers: { "Access-Control-Allow-Origin": "*" },
  });
}
