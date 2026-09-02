import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  verifySlackSignature,
  parseSlackDelivery,
  stripBotMention,
} from "../../src/lib/slack-events";

// The Slack Events API's two guards (SPEC §10.2): the v0 signature (which is also the
// replay guard, via its timestamp) and the classifier that decides what we act on. Both
// are pure — the route is a thin shell over them, same split as github-webhook.ts.

const SECRET = "slack-signing-secret";
const NOW = new Date("2026-09-02T12:00:00Z");

function sign(rawBody: string, timestamp: string, secret = SECRET): string {
  return "v0=" + createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex");
}

const nowTs = () => String(Math.floor(NOW.getTime() / 1000));

describe("verifySlackSignature", () => {
  it("accepts a correctly signed, fresh request", () => {
    const raw = '{"type":"event_callback"}';
    const ts = nowTs();
    expect(
      verifySlackSignature({
        rawBody: raw,
        timestamp: ts,
        signature: sign(raw, ts),
        signingSecret: SECRET,
        now: NOW,
      }),
    ).toBe(true);
  });

  it("rejects a body that changed after signing", () => {
    const ts = nowTs();
    expect(
      verifySlackSignature({
        rawBody: '{"tampered":true}',
        timestamp: ts,
        signature: sign('{"type":"event_callback"}', ts),
        signingSecret: SECRET,
        now: NOW,
      }),
    ).toBe(false);
  });

  it("rejects the wrong signing secret", () => {
    const raw = "{}";
    const ts = nowTs();
    expect(
      verifySlackSignature({
        rawBody: raw,
        timestamp: ts,
        signature: sign(raw, ts, "someone-elses-secret"),
        signingSecret: SECRET,
        now: NOW,
      }),
    ).toBe(false);
  });

  it("rejects a replayed request outside the 5-minute window", () => {
    const raw = "{}";
    const stale = String(Math.floor(NOW.getTime() / 1000) - 6 * 60);
    expect(
      verifySlackSignature({
        rawBody: raw,
        timestamp: stale,
        signature: sign(raw, stale),
        signingSecret: SECRET,
        now: NOW,
      }),
    ).toBe(false);
  });

  it("rejects missing pieces and non-numeric timestamps without throwing", () => {
    const raw = "{}";
    const ts = nowTs();
    const base = { rawBody: raw, signingSecret: SECRET, now: NOW };
    expect(verifySlackSignature({ ...base, timestamp: ts, signature: null })).toBe(false);
    expect(verifySlackSignature({ ...base, timestamp: null, signature: sign(raw, ts) })).toBe(false);
    expect(verifySlackSignature({ ...base, timestamp: "not-a-number", signature: sign(raw, ts) })).toBe(
      false,
    );
    expect(
      verifySlackSignature({
        rawBody: raw,
        timestamp: ts,
        signature: sign(raw, ts),
        signingSecret: undefined,
        now: NOW,
      }),
    ).toBe(false);
    // A short/garbage signature must be a clean false, not a timingSafeEqual throw.
    expect(verifySlackSignature({ ...base, timestamp: ts, signature: "v0=abc" })).toBe(false);
  });
});

describe("parseSlackDelivery", () => {
  const mention = {
    type: "event_callback",
    team_id: "T123",
    event_id: "Ev123",
    event: {
      type: "app_mention",
      channel: "C123",
      user: "U999",
      text: "<@U0BOT> why is login 404ing",
      ts: "1725278400.000100",
    },
  };

  it("returns the challenge for the endpoint handshake", () => {
    expect(parseSlackDelivery({ type: "url_verification", challenge: "abc" })).toEqual({
      kind: "url_verification",
      challenge: "abc",
    });
    // Missing challenge is not a handshake we can answer.
    expect(parseSlackDelivery({ type: "url_verification" })).toBeNull();
  });

  it("parses an app_mention, threading off the message itself", () => {
    expect(parseSlackDelivery(mention)).toEqual({
      kind: "mention",
      teamId: "T123",
      eventId: "Ev123",
      channel: "C123",
      threadTs: "1725278400.000100",
      userId: "U999",
      text: "<@U0BOT> why is login 404ing",
    });
  });

  it("replies into an existing thread when the mention is already in one", () => {
    const inThread = {
      ...mention,
      event: { ...mention.event, thread_ts: "1725270000.000001" },
    };
    expect(parseSlackDelivery(inThread)).toMatchObject({ threadTs: "1725270000.000001" });
  });

  it("treats a DM to the bot as a mention, but not a plain channel message", () => {
    const dm = {
      ...mention,
      event: { ...mention.event, type: "message", channel_type: "im", text: "hi" },
    };
    expect(parseSlackDelivery(dm)).toMatchObject({ kind: "mention", text: "hi" });

    const channelChatter = {
      ...mention,
      event: { ...mention.event, type: "message", channel_type: "channel", text: "unrelated" },
    };
    expect(parseSlackDelivery(channelChatter)).toBeNull();
  });

  it("ignores the bot's own messages — the infinite-loop guard", () => {
    expect(
      parseSlackDelivery({ ...mention, event: { ...mention.event, bot_id: "B123" } }),
    ).toBeNull();
    expect(
      parseSlackDelivery({ ...mention, event: { ...mention.event, bot_profile: {} } }),
    ).toBeNull();
  });

  it("ignores subtyped messages (edits, joins) and empty text", () => {
    expect(
      parseSlackDelivery({ ...mention, event: { ...mention.event, subtype: "message_changed" } }),
    ).toBeNull();
    expect(parseSlackDelivery({ ...mention, event: { ...mention.event, text: "   " } })).toBeNull();
  });

  it("returns null rather than throwing on malformed or unknown payloads", () => {
    expect(parseSlackDelivery(null)).toBeNull();
    expect(parseSlackDelivery({})).toBeNull();
    expect(parseSlackDelivery({ type: "event_callback" })).toBeNull();
    expect(parseSlackDelivery({ ...mention, event_id: undefined })).toBeNull();
    expect(parseSlackDelivery({ type: "something_new", event: {} })).toBeNull();
  });
});

describe("stripBotMention", () => {
  it("removes the bot's mention and normalizes whitespace", () => {
    expect(stripBotMention("<@U0BOT> why is login 404ing", "U0BOT")).toBe("why is login 404ing");
    expect(stripBotMention("hey <@U0BOT>  please   check the docs", "U0BOT")).toBe(
      "hey please check the docs",
    );
    // Slack sometimes renders a mention with a label suffix.
    expect(stripBotMention("<@U0BOT|papervine> hi", "U0BOT")).toBe("hi");
  });

  it("leaves other people's mentions alone — they may matter to the question", () => {
    expect(stripBotMention("<@U0BOT> ask <@U777> about it", "U0BOT")).toBe(
      "ask <@U777> about it",
    );
  });

  it("returns empty for a bare mention, and is a no-op without a bot id", () => {
    expect(stripBotMention("<@U0BOT>", "U0BOT")).toBe("");
    expect(stripBotMention("  <@U0BOT> text  ", "")).toBe("<@U0BOT> text");
  });
});
