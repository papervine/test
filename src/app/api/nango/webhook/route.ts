import { after, type NextRequest } from "next/server";
import { verifyNangoSignature, parseNangoDelivery } from "@/lib/integrations/nango-webhook";
import { recordConnection, forgetConnectionByNangoId } from "@/lib/integrations/nango";

/**
 * Webhooks from Nango (SPEC §10.2) — how a connection made in the browser's Connect UI
 * becomes a row we own.
 *
 * On the **marketing host** (`/api/` passes through ungated there) rather than the app
 * host, matching the GitHub and Slack webhooks; authorization is the HMAC over the raw
 * body, never a session. In production that means the `www` host, not the bare apex,
 * which 308-redirects — see the note in .env.example.
 *
 * Everything acted on here is idempotent (an upsert keyed by connection, or a delete),
 * which is what makes a redelivery harmless — Nango's scheme carries no timestamp and so
 * no replay protection of its own.
 */
export async function POST(req: NextRequest) {
  // Signature is over the RAW bytes — read text() and verify BEFORE parsing.
  const raw = await req.text();
  const ok = verifyNangoSignature(
    raw,
    req.headers.get("x-nango-hmac-sha256"),
    process.env.NANGO_WEBHOOK_SECRET,
  );
  if (!ok) return new Response("bad signature", { status: 401 });

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("bad payload", { status: 400 });
  }

  const delivery = parseNangoDelivery(payload);
  // Sync events, forwarded provider events, failed authorizations: nothing to do. A quiet
  // 204 rather than an error, which Nango would retry pointlessly.
  if (!delivery) return new Response(null, { status: 204 });

  // Ack fast, act after: the connect popup is waiting on Nango, which is waiting on us.
  // Failures in here must never become a non-2xx — that would retry a delivery we may
  // have already applied.
  after(async () => {
    try {
      if (delivery.kind === "connection_created") {
        await recordConnection({
          organizationId: delivery.organizationId,
          providerConfigKey: delivery.providerConfigKey,
          nangoConnectionId: delivery.connectionId,
        });
      } else {
        await forgetConnectionByNangoId(delivery.connectionId);
      }
    } catch (err) {
      console.error("[nango] failed to apply a connection webhook:", err);
    }
  });

  return new Response(null, { status: 200 });
}
