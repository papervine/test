import { NextResponse, type NextRequest } from "next/server";
import { revalidateTag } from "next/cache";
import { affectsEntitlements, parseAutumnEvent, verifyWebhook } from "@/lib/billing/webhook";
import { billingCacheTag } from "@/lib/billing/store";
import { triggerBilling } from "@/lib/realtime";

// Autumn → Papervine webhook (SPEC §10 Billing). Autumn is the source of truth for billing
// state and this route writes NONE of it down: a delivery is a nudge, not data. On an event
// that can change an org's plan or balances it does two things — drops the org's short-lived
// billing cache entry (so the next dashboard render reads fresh) and publishes the org's
// realtime signal (so a dashboard that is open right now re-renders on its own). Both are
// best-effort; if realtime is unconfigured the cache drop alone means the next navigation is
// correct, and if the webhook never arrives the cache expires on its own within a minute.
//
// Delivery is via Svix (Standard Webhooks): verified by HMAC over id.timestamp.body with the
// endpoint secret from Autumn's dashboard (AUTUMN_WEBHOOK_SECRET). Unsigned or badly signed
// deliveries are 401 and do nothing. Replays are harmless by construction (idempotent nudge),
// so there is no delivery table — the Stripe one this replaces existed to store state.
//
// Unconfigured (no secret) → 503, which Autumn will retry and surface in its dashboard; that
// is the right visibility for "you registered the URL but not the secret". Self-hosted
// installs never register the URL, so they never see this route.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const secret = process.env.AUTUMN_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "webhook_not_configured" }, { status: 503 });
  }
  const body = await req.text();
  const verdict = verifyWebhook({
    secret,
    headers: {
      id: req.headers.get("svix-id"),
      timestamp: req.headers.get("svix-timestamp"),
      signature: req.headers.get("svix-signature"),
    },
    body,
    now: new Date(),
  });
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.reason }, { status: 401 });
  }

  const event = parseAutumnEvent(body);
  if (!event) return NextResponse.json({ error: "bad_json" }, { status: 400 });
  // Unknown events and events without a customer are acknowledged, not rejected — Autumn may
  // add types, and a retry storm over something we ignore helps nobody.
  if (!event.customerId || !affectsEntitlements(event.type)) {
    return NextResponse.json({ ok: true, ignored: event.type || "unknown" });
  }

  revalidateTag(billingCacheTag(event.customerId), "max");
  await triggerBilling(event.customerId);
  return NextResponse.json({ ok: true, type: event.type });
}
