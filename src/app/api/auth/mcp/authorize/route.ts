import { auth } from "@/lib/auth";
import { requestOrigin } from "@/lib/mcp-oauth-metadata";

/**
 * The MCP authorize endpoint, wrapped to make consent **mandatory** (SPEC §9.2/§11).
 *
 * Better Auth's `mcp` plugin shows a consent screen only when the client asks for one
 * (`prompt=consent`); without it, a signed-in user's authorize request returns an authorization
 * code immediately. Pair that with dynamic client registration — anyone can register a client,
 * naming any redirect URI — and the result is a silent grant of a **write-scoped** token: get a
 * signed-in user to load an authorize URL and their docs are yours to edit, with nothing shown
 * to them at any point.
 *
 * A client asking to skip consent is precisely the request not to honour, so `prompt` is set
 * here rather than trusted from the query. This route shadows Better Auth's catch-all (a
 * specific segment wins over `[...all]`), redirects once to add the parameter, and then hands
 * the request to the same handler — so the plugin still owns the whole flow and there is no
 * second implementation of it to drift.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);

  if (url.searchParams.get("prompt") !== "consent") {
    url.searchParams.set("prompt", "consent");
    // Rebuild on the request's own origin: `req.url` carries the server's internal host inside a
    // route handler, so redirecting to it verbatim would move the user off the app host
    // mid-flow and lose the session cookie the consent screen needs.
    const target = `${requestOrigin(req)}${url.pathname}${url.search}`;
    return Response.redirect(target, 302);
  }

  return auth.handler(req);
}
