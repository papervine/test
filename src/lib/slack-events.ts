import { createHmac, timingSafeEqual } from "node:crypto";

// Pure helpers for the Slack Events API (SPEC §10.2 — the Agent's inbound half). Kept
// out of the route and out of any server-only module so they unit-test without a server,
// DB, or network — the route is a thin shell over these (mirrors github-webhook.ts).

/** Slack rejects/retries anything older than 5 minutes; so do we (replay window). */
const MAX_SKEW_SECONDS = 60 * 5;

/**
 * Verify a Slack request signature (v0 scheme). Slack signs
 * `v0:{timestamp}:{rawBody}` with the app's **signing secret** and sends
 * `X-Slack-Signature: v0=<hex>` plus `X-Slack-Request-Timestamp`. As with the GitHub
 * webhook the body must be read RAW (req.text()) before parsing, or the bytes won't match.
 *
 * The timestamp check is what makes a captured request unreplayable, so it is part of
 * verification rather than a separate concern. `now` is injectable for tests.
 */
export function verifySlackSignature(input: {
  rawBody: string;
  timestamp: string | null | undefined;
  signature: string | null | undefined;
  signingSecret: string | undefined;
  now?: Date;
}): boolean {
  const { rawBody, timestamp, signature, signingSecret } = input;
  if (!timestamp || !signature || !signingSecret) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const nowSeconds = Math.floor((input.now?.getTime() ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - ts) > MAX_SKEW_SECONDS) return false;

  const expected =
    "v0=" +
    createHmac("sha256", signingSecret).update(`v0:${timestamp}:${rawBody}`).digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch — guard so a wrong-length header is a
  // clean false, and still compare when equal-length to keep the timing flat.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * What the route needs out of an inbound delivery. Three shapes:
 *  - `url_verification` — Slack's endpoint handshake; echo the challenge.
 *  - `mention` — an `app_mention` in a channel, or a DM to the bot (`message.im`).
 *    Both are "someone is talking to the agent", so they collapse to one kind.
 *  - null — anything we don't act on (the bot's own messages, edits, joins, unknown
 *    events). Returning null rather than throwing keeps an unrecognized Slack event a
 *    204, never a 500 that makes Slack disable the endpoint.
 */
export type SlackDelivery =
  | { kind: "url_verification"; challenge: string }
  | {
      kind: "mention";
      teamId: string;
      /** Slack's per-delivery id — our idempotency key (Slack retries on any non-2xx). */
      eventId: string;
      channel: string;
      /** The thread to reply in: an existing thread, else the message itself starts one. */
      threadTs: string;
      userId: string;
      text: string;
    }
  | null;

type RawSlackPayload = {
  type?: string;
  challenge?: string;
  team_id?: string;
  event_id?: string;
  event?: {
    type?: string;
    subtype?: string;
    channel?: string;
    channel_type?: string;
    user?: string;
    bot_id?: string;
    bot_profile?: unknown;
    text?: string;
    ts?: string;
    thread_ts?: string;
  };
};

export function parseSlackDelivery(payload: unknown): SlackDelivery {
  const body = (payload ?? {}) as RawSlackPayload;

  if (body.type === "url_verification") {
    return typeof body.challenge === "string"
      ? { kind: "url_verification", challenge: body.challenge }
      : null;
  }
  if (body.type !== "event_callback") return null;

  const event = body.event;
  if (!event || !body.team_id || !body.event_id) return null;

  // Never answer ourselves: the bot's own reply in a channel comes back as a message
  // event, and an agent replying to its own reply is an infinite loop on our own credits.
  if (event.bot_id || event.bot_profile) return null;
  // Edits, deletions, joins, file-shares-with-no-text: subtyped messages aren't asks.
  if (event.subtype) return null;

  const isMention = event.type === "app_mention";
  // A DM to the bot needs no @mention to be addressed at us — but only in an actual DM
  // (`im`), never a channel message that merely lacks a mention.
  const isDirectMessage = event.type === "message" && event.channel_type === "im";
  if (!isMention && !isDirectMessage) return null;

  const text = (event.text ?? "").trim();
  const ts = event.ts;
  if (!event.channel || !event.user || !ts || !text) return null;

  return {
    kind: "mention",
    teamId: body.team_id,
    eventId: body.event_id,
    channel: event.channel,
    // Reply in the existing thread when there is one, otherwise start one off this
    // message — so the agent never answers into the channel's top level.
    threadTs: event.thread_ts ?? ts,
    userId: event.user,
    text,
  };
}

/**
 * Strip the bot's own @mention(s) from the text, so the agent sees the question rather
 * than "<@U123> why is login 404ing". Other mentions are left alone — they may be
 * meaningful to the question.
 */
export function stripBotMention(text: string, botUserId: string): string {
  if (!botUserId) return text.trim();
  return text.replace(new RegExp(`<@${botUserId}(\\|[^>]*)?>`, "g"), " ").replace(/\s+/g, " ").trim();
}
