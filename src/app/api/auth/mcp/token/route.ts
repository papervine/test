import { auth } from "@/lib/auth";

/**
 * The advertised OAuth `token_endpoint`, wrapped so it honours **every** grant the discovery
 * document claims (SPEC §11.5).
 *
 * Two Better Auth plugins mount two token endpoints: `mcp` puts the authorization-code exchange
 * at `/api/auth/mcp/token`, and `deviceAuthorization` puts the device-code exchange at
 * `/api/auth/device/token`. RFC 8414 has exactly one `token_endpoint` field, and RFC 8628 §3.4
 * says the device grant is redeemed at *that* endpoint — so a spec-following client reads our
 * metadata, sees `urn:ietf:params:oauth:grant-type:device_code` in `grant_types_supported`, POSTs
 * it to the advertised endpoint, and gets a schema error from a handler that only knows about
 * authorization codes.
 *
 * The alternative was to advertise a second, non-standard token endpoint and hope clients read
 * the comment. Naming a field no registry defines is not discovery; it's a footnote. So the
 * document stays standards-true and this route makes it so, by the same trick as its `authorize`
 * sibling: shadow the catch-all (a specific segment beats `[...all]`), then hand off to the same
 * `auth.handler`. Neither grant gets a second implementation to drift.
 *
 * Both content types are accepted because the two halves disagree: OAuth specifies
 * `application/x-www-form-urlencoded` for token requests, and Better Auth's device endpoint
 * validates a JSON body. Parsing here and re-encoding as JSON is what lets a client that follows
 * the RFC talk to a plugin that doesn't.
 *
 * Papervine's own CLI does NOT come through here — it calls `/api/auth/device/token` directly,
 * saving a discovery round trip on a URL it can hard-code. This route is for everyone else.
 */
export const dynamic = "force-dynamic";

const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

/** Read a token request's fields out of either encoding, without throwing on a malformed body. */
function parseFields(raw: string, contentType: string): Record<string, string> {
  if (contentType.includes("application/json")) {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

export async function POST(req: Request): Promise<Response> {
  // The body can only be read once, so it is consumed here and both branches re-issue it.
  const raw = await req.text();
  const fields = parseFields(raw, req.headers.get("content-type") ?? "");

  if (fields.grant_type !== DEVICE_GRANT) {
    // Anything else is the plugin's own business, byte for byte — including the headers, which
    // carry `Authorization` for a confidential client's `client_secret_basic`.
    return auth.handler(new Request(req.url, { method: "POST", headers: req.headers, body: raw }));
  }

  const url = new URL(req.url);
  url.pathname = "/api/auth/device/token";
  return auth.handler(
    new Request(url, {
      method: "POST",
      // Deliberately NOT forwarding the original headers: a form-encoded content-type would make
      // the device endpoint reject a body we have just re-encoded as JSON. This grant is for
      // public clients with no secret, so there is no credential header to lose.
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        grant_type: DEVICE_GRANT,
        device_code: fields.device_code ?? "",
        client_id: fields.client_id ?? "",
      }),
    }),
  );
}
