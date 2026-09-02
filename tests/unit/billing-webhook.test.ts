// Autumn webhook verification (src/lib/billing/webhook.ts) — Standard Webhooks / Svix scheme,
// implemented with Node crypto. Vectors are built with the module's own signer, so the tests
// pin the CONTRACT (what is signed, what is rejected), not a copied constant.
import { describe, expect, it } from "vitest";
import {
  affectsEntitlements,
  decodeWebhookSecret,
  parseAutumnEvent,
  signWebhook,
  verifyWebhook,
} from "@/lib/billing/webhook";

const KEY_B64 = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
const SECRET = `whsec_${KEY_B64}`;
const now = new Date("2026-09-02T12:00:00Z");
const ts = String(Math.floor(now.getTime() / 1000));
const body = JSON.stringify({ type: "billing.updated", customer_id: "org_123", data: {} });

function headers(overrides: Partial<{ id: string; timestamp: string; signature: string }> = {}) {
  const key = decodeWebhookSecret(SECRET)!;
  const id = overrides.id ?? "msg_1";
  const timestamp = overrides.timestamp ?? ts;
  const signature = overrides.signature ?? `v1,${signWebhook(key, id, timestamp, body)}`;
  return { id, timestamp, signature };
}

describe("verifyWebhook", () => {
  it("accepts a correctly signed, fresh delivery", () => {
    expect(verifyWebhook({ secret: SECRET, headers: headers(), body, now })).toEqual({ ok: true });
  });

  it("accepts a bare base64 secret as well as the whsec_ form", () => {
    expect(verifyWebhook({ secret: KEY_B64, headers: headers(), body, now })).toEqual({ ok: true });
  });

  it("accepts when any one of several rotated signatures matches", () => {
    const h = headers();
    const sig = `v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= ${h.signature}`;
    expect(verifyWebhook({ secret: SECRET, headers: { ...h, signature: sig }, body, now }).ok).toBe(true);
  });

  it("rejects a tampered body", () => {
    const r = verifyWebhook({ secret: SECRET, headers: headers(), body: body + " ", now });
    expect(r).toEqual({ ok: false, reason: "no_matching_signature" });
  });

  it("rejects the wrong secret", () => {
    const other = `whsec_${Buffer.from("ffffffffffffffffffffffffffffffff").toString("base64")}`;
    expect(verifyWebhook({ secret: other, headers: headers(), body, now })).toEqual({
      ok: false,
      reason: "no_matching_signature",
    });
  });

  it("rejects a replay outside the tolerance window, even if correctly signed", () => {
    const old = String(Math.floor(now.getTime() / 1000) - 6 * 60);
    const r = verifyWebhook({ secret: SECRET, headers: headers({ timestamp: old }), body, now });
    expect(r).toEqual({ ok: false, reason: "stale_timestamp" });
  });

  it("rejects missing headers and non-numeric timestamps", () => {
    expect(
      verifyWebhook({ secret: SECRET, headers: { id: null, timestamp: ts, signature: "v1,x" }, body, now }),
    ).toEqual({ ok: false, reason: "missing_headers" });
    expect(
      verifyWebhook({ secret: SECRET, headers: headers({ timestamp: "yesterday" }), body, now }),
    ).toEqual({ ok: false, reason: "bad_timestamp" });
  });

  it("ignores signature entries that are not v1", () => {
    const h = headers();
    const sig = h.signature.replace("v1,", "v2,");
    expect(verifyWebhook({ secret: SECRET, headers: { ...h, signature: sig }, body, now }).ok).toBe(false);
  });
});

describe("parseAutumnEvent", () => {
  it("reads type and customer id from the top level or from data", () => {
    expect(parseAutumnEvent(body)).toEqual({ type: "billing.updated", customerId: "org_123" });
    expect(
      parseAutumnEvent(JSON.stringify({ type: "balances.limit_reached", data: { customer_id: "org_9" } })),
    ).toEqual({ type: "balances.limit_reached", customerId: "org_9" });
    expect(
      parseAutumnEvent(JSON.stringify({ type: "billing.updated", data: { customer: { id: "org_7" } } })),
    ).toEqual({ type: "billing.updated", customerId: "org_7" });
  });

  it("returns null for a body that is not JSON, and null customer when none is present", () => {
    expect(parseAutumnEvent("not json")).toBeNull();
    expect(parseAutumnEvent(JSON.stringify({ type: "billing.updated" }))).toEqual({
      type: "billing.updated",
      customerId: null,
    });
  });
});

describe("affectsEntitlements", () => {
  it("is true for plan and balance events, false for anything else", () => {
    expect(affectsEntitlements("billing.updated")).toBe(true);
    expect(affectsEntitlements("balances.limit_reached")).toBe(true);
    expect(affectsEntitlements("billing.auto_topup_failed")).toBe(true);
    expect(affectsEntitlements("ping")).toBe(false);
  });
});
