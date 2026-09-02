/**
 * Autumn webhook verification and parsing (SPEC §10 Billing). PURE — no I/O — so it is
 * unit-tested against fixed vectors and the route stays a thin shell.
 *
 * Autumn delivers webhooks through Svix, which follows the Standard Webhooks spec: three
 * headers (`svix-id`, `svix-timestamp`, `svix-signature`) and an HMAC-SHA256 over
 * `${id}.${timestamp}.${rawBody}` keyed with the endpoint secret. The secret Autumn's
 * dashboard shows is `whsec_<base64 key>`; the key is the decoded part. `svix-signature`
 * may carry several space-separated `v1,<base64>` entries (key rotation) — any one match is a
 * pass. Timestamps outside a tolerance window are rejected to blunt replay. No Svix library:
 * this is fifteen lines of Node crypto, and one endpoint does not earn a dependency.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

export type WebhookHeaders = {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
};

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "missing_headers" | "bad_timestamp" | "stale_timestamp" | "no_matching_signature" | "bad_secret" };

/** Decode the endpoint secret: `whsec_` + base64 (the raw key bytes). Accepts a bare base64 too. */
export function decodeWebhookSecret(secret: string): Buffer | null {
  const raw = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  if (!raw) return null;
  try {
    const buf = Buffer.from(raw, "base64");
    return buf.length ? buf : null;
  } catch {
    return null;
  }
}

/** Compute the `v1` signature for a delivery — exported so tests can build valid vectors. */
export function signWebhook(key: Buffer, id: string, timestamp: string, body: string): string {
  return createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
}

export function verifyWebhook(input: {
  secret: string;
  headers: WebhookHeaders;
  body: string;
  now: Date;
}): VerifyResult {
  const { id, timestamp, signature } = input.headers;
  if (!id || !timestamp || !signature) return { ok: false, reason: "missing_headers" };
  const key = decodeWebhookSecret(input.secret);
  if (!key) return { ok: false, reason: "bad_secret" };

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: "bad_timestamp" };
  const skew = Math.abs(input.now.getTime() / 1000 - ts);
  if (skew > TIMESTAMP_TOLERANCE_SECONDS) return { ok: false, reason: "stale_timestamp" };

  const expected = Buffer.from(signWebhook(key, id, timestamp, input.body), "base64");
  for (const entry of signature.split(" ")) {
    const [version, sig] = entry.split(",", 2);
    if (version !== "v1" || !sig) continue;
    let candidate: Buffer;
    try {
      candidate = Buffer.from(sig, "base64");
    } catch {
      continue;
    }
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) {
      return { ok: true };
    }
  }
  return { ok: false, reason: "no_matching_signature" };
}

/**
 * The subset of an Autumn event this app acts on. Every event type we know of carries the
 * customer (our org id) at the top level or under `data`; anything else is ignored, not
 * rejected — Autumn may add events, and a 2xx for the unknown ones keeps its retries quiet.
 */
export type AutumnEvent = { type: string; customerId: string | null };

export function parseAutumnEvent(body: string): AutumnEvent | null {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return null;
  }
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const data = (o.data && typeof o.data === "object" ? o.data : {}) as Record<string, unknown>;
  const type = typeof o.type === "string" ? o.type : typeof o.event === "string" ? o.event : "";
  const cid =
    (typeof o.customer_id === "string" && o.customer_id) ||
    (typeof data.customer_id === "string" && data.customer_id) ||
    (data.customer && typeof data.customer === "object" && typeof (data.customer as { id?: unknown }).id === "string"
      ? ((data.customer as { id: string }).id)
      : null);
  return { type, customerId: cid || null };
}

/** The events that mean "this org's plan/entitlements may have changed" — worth a refresh. */
export function affectsEntitlements(type: string): boolean {
  return type === "billing.updated" || type.startsWith("balances.") || type.startsWith("billing.");
}
