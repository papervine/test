/**
 * OAuth discovery documents for the authoring MCP (SPEC §9.2/§11).
 *
 * Better Auth's `mcp` plugin ships builders for both of these, and we don't use them, for a
 * reason specific to this deployment: they derive every URL from the single configured
 * `baseURL`, which here is the **apex** (`papervine.io`). The control plane — the session
 * cookie, the consent screen, `/api/auth/mcp/*` — lives on the **app host**. A client told to
 * authorize at the apex would land where there is no session to consent with, and in dev the
 * mismatch is worse still: `BETTER_AUTH_URL` says `localhost:3000` while `next dev` may well
 * be on 3001 because another worktree holds the port.
 *
 * They also throw outright when `baseURL` is unset (`new URL("")`), which turns the zero-dep
 * smoke gate and any unconfigured self-host into a 500 on a document whose whole job is to be
 * fetchable before anything is configured.
 *
 * So: derive from an origin we resolve per request. Both documents are built here, from one
 * origin, so they can never disagree with each other — a client reads the resource metadata to
 * find the authorization server, and gets sent somewhere the next fetch actually works.
 *
 * The field sets mirror what the plugin's endpoints implement; keep them in step if the
 * plugin's own builders change (`node_modules/better-auth/dist/plugins/mcp/index.mjs`).
 */

import { originFromHost } from "@papervine/renderer/lib/origin";

/** Where Better Auth is mounted, relative to an origin (`src/app/api/auth/[...all]`). */
const AUTH_BASE = "/api/auth";

/** Scopes the plugin's authorize endpoint understands. */
const SCOPES = ["openid", "profile", "email", "offline_access"];

export function protectedResourceMetadata(origin: string) {
  return {
    resource: origin,
    authorization_servers: [origin],
    jwks_uri: `${origin}${AUTH_BASE}/mcp/jwks`,
    scopes_supported: SCOPES,
    bearer_methods_supported: ["header"],
    resource_signing_alg_values_supported: ["RS256"],
  };
}

export function authorizationServerMetadata(origin: string) {
  const base = `${origin}${AUTH_BASE}`;
  return {
    issuer: origin,
    authorization_endpoint: `${base}/mcp/authorize`,
    token_endpoint: `${base}/mcp/token`,
    userinfo_endpoint: `${base}/mcp/userinfo`,
    jwks_uri: `${base}/mcp/jwks`,
    // Dynamic client registration. This is the field that makes "paste a URL into Cursor and
    // it just works" possible — without it every client would need credentials issued by hand.
    registration_endpoint: `${base}/mcp/register`,
    scopes_supported: SCOPES,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    token_endpoint_auth_methods_supported: [
      "client_secret_basic",
      "client_secret_post",
      "none",
    ],
    // PKCE. Required by OAuth 2.1 and by the MCP authorization spec, and the only thing
    // protecting a public client's authorization code in transit.
    code_challenge_methods_supported: ["S256"],
  };
}

/**
 * The origin to advertise: the one the client is already talking to.
 *
 * From the `Host` header, NOT from `req.url`. In a Next route handler `req.url` carries the
 * server's own internal origin — a request to `http://app.localhost:3001` reads back as
 * `http://localhost:3001`, so every URL in these documents would name a host the client never
 * asked for and where its session cookie doesn't exist. Verified by fetching the route with an
 * explicit Host header and watching it come back wrong.
 *
 * `originFromHost` is the shared helper the SEO/metadataBase path already uses; it handles the
 * `x-forwarded-proto` and localhost-scheme rules in one place.
 *
 * Falls back to `req.url`'s origin only if the Host header is missing or malformed — a
 * degraded answer beats a 500 on a document whose job is to be fetchable.
 */
export function requestOrigin(req: Request): string {
  const host = req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto");
  return originFromHost(host, proto) ?? new URL(req.url).origin;
}
