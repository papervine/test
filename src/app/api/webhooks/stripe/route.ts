import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { stripeEvent } from "@/lib/db/app-schema";
import { stripeClient } from "@/lib/billing/stripe";
import { handleStripeEvent } from "@/lib/billing/webhooks";

// Stripe webhook receiver (SPEC §10 Billing, rule 3): the ONLY mutation path into paid
// subscription state. Flow: verify signature → record in stripe_event (PK = Stripe's
// event id; conflict = already seen → 200 immediately, making redeliveries no-ops) →
// process → stamp processedAt (or error). A handler failure returns 500 so Stripe
// retries — and because we row-lock nothing and every handler is idempotent, the retry
// converges. Local dev: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const stripe = stripeClient();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) {
    return NextResponse.json({ error: "Billing not configured." }, { status: 503 });
  }

  // Raw body required — any parse/re-serialize breaks the signature.
  const body = await req.text();
  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature." }, { status: 400 });

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, secret);
  } catch {
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  // Dedupe on SUCCESSFUL processing only: a row with processedAt set means done (200,
  // Stripe stops); a row without it is a previous failed attempt — fall through and
  // reprocess (handlers are idempotent), otherwise the retry would be deduped away and
  // the event lost forever.
  const inserted = await db
    .insert(stripeEvent)
    .values({ id: event.id, type: event.type, payload: event as unknown as object })
    .onConflictDoNothing()
    .returning({ id: stripeEvent.id });
  if (inserted.length === 0) {
    const [existing] = await db
      .select({ processedAt: stripeEvent.processedAt })
      .from(stripeEvent)
      .where(eq(stripeEvent.id, event.id))
      .limit(1);
    if (existing?.processedAt) return NextResponse.json({ ok: true, deduped: true });
  }

  try {
    await handleStripeEvent(event);
    await db
      .update(stripeEvent)
      .set({ processedAt: new Date(), error: null })
      .where(eq(stripeEvent.id, event.id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[billing] webhook ${event.type} (${event.id}) failed:`, err);
    await db
      .update(stripeEvent)
      .set({ error: message })
      .where(eq(stripeEvent.id, event.id));
    // 500 → Stripe retries; the null processedAt above lets the retry through.
    return NextResponse.json({ error: "Handler failed." }, { status: 500 });
  }
}
