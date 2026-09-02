import { createHmac, timingSafeEqual } from "node:crypto";

// Pure helpers for webhooks Nango sends us (SPEC §10.2). Kept out of the route and out of
// any server-only module so they unit-test without a server, DB, or network — the same
// split as github-webhook.ts and slack-events.ts.

/**
 * Verify a Nango webhook's signature: HMAC-SHA256 of the **raw body** under the
 * environment's webhook signing key, hex, in `X-Nango-Hmac-Sha256`.
 *
 * As with every other webhook here the body must be read RAW (`req.text()`) and verified
 * before parsing, or the bytes won't match. Any missing/short/mismatched input is a
 * rejection rather than a throw.
 *
 * Note there is NO timestamp in this scheme (unlike Slack's v0), so it carries no replay
 * protection of its own. That's tolerable because every delivery we act on is an upsert
 * keyed by connection id — replaying one re-writes the same row — but it's the reason
 * nothing here may perform a non-idempotent action.
 */
export function verifyNangoSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  signingKey: string | undefined,
): boolean {
  if (!signatureHeader || !signingKey) return false;
  const expected = createHmac("sha256", signingKey).update(rawBody).digest("hex");
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch — guard so a wrong-length header is a clean
  // false, and still compare when equal-length to keep the timing flat.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * What the route acts on. Nango sends several webhook types (auth, sync, forwarded
 * provider events); we care only about a connection appearing or going away.
 *
 * `null` for everything else — an unrecognized delivery must be a quiet 2xx, never an
 * error that makes Nango retry a webhook we were never going to act on.
 */
export type NangoDelivery =
  | {
      kind: "connection_created";
      connectionId: string;
      providerConfigKey: string;
      /** Our org id, echoed back from the connect session's end_user. */
      organizationId: string;
    }
  | { kind: "connection_deleted"; connectionId: string }
  | null;

type RawNangoWebhook = {
  type?: string;
  operation?: string;
  success?: boolean;
  connectionId?: string;
  providerConfigKey?: string;
  tags?: { organization_id?: string; end_user_id?: string };
  // Older/alternate shape seen in their docs for the end-user block.
  endUser?: { organizationId?: string; organization_id?: string; endUserId?: string };
};

export function parseNangoDelivery(payload: unknown): NangoDelivery {
  const body = (payload ?? {}) as RawNangoWebhook;
  if (body.type !== "auth") return null;

  const connectionId = body.connectionId;
  if (!connectionId) return null;

  if (body.operation === "deletion") return { kind: "connection_deleted", connectionId };
  if (body.operation !== "creation") return null;
  // A failed authorization is reported with the same type/operation — recording it would
  // create a connection row for an authorization that never completed.
  if (body.success === false) return null;

  const providerConfigKey = body.providerConfigKey;
  // The org id we passed as the connect session's end_user. Read from both shapes their
  // docs show, since a connection created outside our session flow may carry neither —
  // and without it we cannot attribute the connection to a tenant, so we don't.
  const organizationId =
    body.tags?.organization_id ??
    body.endUser?.organizationId ??
    body.endUser?.organization_id;

  if (!providerConfigKey || !organizationId) return null;
  return { kind: "connection_created", connectionId, providerConfigKey, organizationId };
}
