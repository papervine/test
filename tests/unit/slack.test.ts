import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { encryptSecret } from "../../src/lib/crypto";

// Slack workspace install (SPEC §10.2) — the config gate, the AES-GCM install state
// that survives the round trip to slack.com, and the oauth.v2.access exchange's
// ok:false handling (Slack returns 200 on failure, so status alone is not enough).
const ORIGINAL = { ...process.env };

beforeEach(() => {
  process.env.SLACK_CLIENT_ID = "1234.5678";
  process.env.SLACK_CLIENT_SECRET = "testsecret";
  process.env.SLACK_SIGNING_SECRET = "signingsecret";
  process.env.BETTER_AUTH_URL = "https://app.papervine.io";
  process.env.PAPERVINE_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("isSlackConfigured", () => {
  it("requires all three credentials", async () => {
    const m = await import("../../src/lib/slack");
    expect(m.isSlackConfigured()).toBe(true);
    delete process.env.SLACK_SIGNING_SECRET;
    expect(m.isSlackConfigured()).toBe(false);
    delete process.env.SLACK_CLIENT_SECRET;
    expect(m.isSlackConfigured()).toBe(false);
  });
});

describe("install state", () => {
  it("round-trips org and site", async () => {
    const m = await import("../../src/lib/slack");
    const state = m.encodeSlackInstallState({ org: "dev-org", site: "starter" });
    expect(m.decodeSlackInstallState(state)).toMatchObject({ org: "dev-org", site: "starter" });
  });

  it("rejects a tampered, garbage, or missing state", async () => {
    const m = await import("../../src/lib/slack");
    const state = m.encodeSlackInstallState({ org: "dev-org", site: "starter" });
    expect(m.decodeSlackInstallState(state.slice(0, -4) + "AAAA")).toBeNull();
    expect(m.decodeSlackInstallState("not-a-state")).toBeNull();
    expect(m.decodeSlackInstallState(null)).toBeNull();
  });

  it("rejects a state encrypted with the right key but the wrong shape", async () => {
    const m = await import("../../src/lib/slack");
    expect(m.decodeSlackInstallState(encryptSecret(JSON.stringify({ org: "x" })))).toBeNull();
    expect(m.decodeSlackInstallState(encryptSecret("[]"))).toBeNull();
  });

  it("expires after the TTL", async () => {
    vi.useFakeTimers();
    const m = await import("../../src/lib/slack");
    const state = m.encodeSlackInstallState({ org: "dev-org", site: "starter" });
    vi.advanceTimersByTime(29 * 60_000);
    expect(m.decodeSlackInstallState(state)).not.toBeNull();
    vi.advanceTimersByTime(2 * 60_000);
    expect(m.decodeSlackInstallState(state)).toBeNull();
  });
});

describe("slackInstallUrl", () => {
  it("builds the authorize URL with scopes, state, and the app-host redirect", async () => {
    const m = await import("../../src/lib/slack");
    const url = new URL(m.slackInstallUrl("thestate")!);
    expect(url.origin + url.pathname).toBe("https://slack.com/oauth/v2/authorize");
    expect(url.searchParams.get("client_id")).toBe("1234.5678");
    expect(url.searchParams.get("state")).toBe("thestate");
    expect(url.searchParams.get("scope")).toContain("app_mentions:read");
    expect(url.searchParams.get("scope")).toContain("chat:write");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.papervine.io/api/slack/oauth",
    );
  });

  it("maps BETTER_AUTH_URL onto the app host", async () => {
    process.env.BETTER_AUTH_URL = "https://papervine.io";
    const m = await import("../../src/lib/slack");
    expect(m.slackRedirectUri()).toBe("https://app.papervine.io/api/slack/oauth");
  });

  it("is null when unconfigured", async () => {
    delete process.env.SLACK_CLIENT_ID;
    const m = await import("../../src/lib/slack");
    expect(m.slackInstallUrl("s")).toBeNull();
  });

  // Local dev only. Slack requires https, and the derivation can't reach a tunnel:
  // appOriginFor maps a host onto its `app.` label, so `foo.ngrok.app` would become
  // `app.foo.ngrok.app` — a host no tunnel serves and no cert covers.
  it("SLACK_REDIRECT_URI overrides the derived app-host URL", async () => {
    process.env.SLACK_REDIRECT_URI = "https://foo.ngrok.app/api/slack/oauth";
    const m = await import("../../src/lib/slack");
    expect(m.slackRedirectUri()).toBe("https://foo.ngrok.app/api/slack/oauth");
    // The authorize URL must carry the SAME value — Slack rejects a mismatch between
    // authorize and the code exchange, which is why both read this one function.
    expect(new URL(m.slackInstallUrl("s")!).searchParams.get("redirect_uri")).toBe(
      "https://foo.ngrok.app/api/slack/oauth",
    );
  });

  it("ignores a blank override rather than producing an empty redirect", async () => {
    process.env.SLACK_REDIRECT_URI = "   ";
    const m = await import("../../src/lib/slack");
    expect(m.slackRedirectUri()).toBe("https://app.papervine.io/api/slack/oauth");
  });
});

describe("exchangeSlackCode", () => {
  it("returns the install on ok:true", async () => {
    const m = await import("../../src/lib/slack");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            ok: true,
            access_token: "xoxb-token",
            scope: "app_mentions:read,chat:write",
            bot_user_id: "U123",
            team: { id: "T123", name: "Acme" },
          }),
          { status: 200 },
        ),
      ),
    );
    expect(await m.exchangeSlackCode("code")).toEqual({
      teamId: "T123",
      teamName: "Acme",
      botUserId: "U123",
      botToken: "xoxb-token",
      scopes: "app_mentions:read,chat:write",
    });
  });

  it("surfaces Slack's error on 200 ok:false", async () => {
    const m = await import("../../src/lib/slack");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: false, error: "invalid_code" }), { status: 200 }),
      ),
    );
    expect(await m.exchangeSlackCode("code")).toEqual({ error: "invalid_code" });
  });
});
