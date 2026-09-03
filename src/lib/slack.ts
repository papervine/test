import "server-only";
import { encryptSecret, decryptSecret } from "./crypto";
import { appOriginFor } from "./tenant-host";

/**
 * Slack workspace install for the Agent (SPEC §10.2) — OUR Slack app, first-party.
 *
 * The agent's transport is Slack-centric: an org admin installs the Papervine Slack app
 * into their workspace (OAuth v2), we keep the workspace's bot token encrypted on
 * `slack_workspace`, and the events endpoint later resolves inbound mentions back to the
 * org through the team id. Deliberately NOT routed through Nango (which backs the
 * attach-services catalog): Slack's inbound events/interactivity must hit our own
 * signed endpoint regardless, and the one connection every org has shouldn't ride a
 * metered third-party vault. The app itself is created once from slack-app-manifest.json.
 */

const OAUTH_AUTHORIZE = "https://slack.com/oauth/v2/authorize";
const OAUTH_ACCESS = "https://slack.com/api/oauth.v2.access";

// Bot scopes the current code depends on. Requested at install; also compared against
// the stored `scopes` column so an old install can be prompted to reinstall when the
// code grows a new requirement. Keep in sync with slack-app-manifest.json.
export const REQUIRED_BOT_SCOPES = [
  "app_mentions:read", // receive @papervine mentions
  "chat:write", // post + edit replies (post-and-edit streaming)
  "channels:read", // resolve channel names for the allowlist UI
  "im:history", // read DMs to the bot (message.im events)
] as const;

export function slackConfig(): {
  clientId: string;
  clientSecret: string;
  signingSecret: string;
} | null {
  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!clientId || !clientSecret || !signingSecret) return null;
  return { clientId, clientSecret, signingSecret };
}

/** True when this deployment can install the Slack app. Gates the banner's button —
 * unset env means the banner says "not configured", nothing throws (house style). */
export function isSlackConfigured(): boolean {
  return slackConfig() !== null;
}

/**
 * What survives the round trip to slack.com — same discipline as GithubFlowState:
 * AES-GCM-encrypted (tampering fails decrypt, not gets acted on), identifiers only
 * (org/site slugs, never a path), short TTL so a leaked link isn't replayable.
 * Authorization is still re-derived from the session in the callback; the state only
 * stops a crafted link binding an install to an org nobody chose.
 */
export type SlackInstallState = {
  org: string;
  site: string;
  at: number;
};

const STATE_TTL_MS = 30 * 60_000;

export function encodeSlackInstallState(state: Omit<SlackInstallState, "at">): string {
  return encryptSecret(JSON.stringify({ ...state, at: Date.now() }));
}

export function decodeSlackInstallState(raw: string | null): SlackInstallState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decryptSecret(raw)) as SlackInstallState;
    if (typeof parsed?.org !== "string" || !parsed.org) return null;
    if (typeof parsed?.site !== "string" || !parsed.site) return null;
    if (typeof parsed?.at !== "number" || Date.now() - parsed.at > STATE_TTL_MS) return null;
    return { org: parsed.org, site: parsed.site, at: parsed.at };
  } catch {
    return null;
  }
}

/**
 * The one redirect URL this deployment uses, derived from BETTER_AUTH_URL (always set)
 * mapped onto the app host — where the session cookie lives. Must be listed in the
 * Slack app's OAuth redirect URLs, and Slack requires the SAME value verbatim in
 * authorize and the code exchange, so both call this.
 *
 * `SLACK_REDIRECT_URI` overrides the derivation, and exists for LOCAL DEV. Slack accepts
 * only https redirect URLs, so testing the install flow means tunnelling — and the
 * derivation can't reach a tunnel: `appOriginFor` maps a host to its `app.` label, so a
 * tunnel at `foo.ngrok.app` becomes `app.foo.ngrok.app`, which no tunnel serves and no
 * certificate covers. (A tunnel hostname that already starts with `app.` is a fixed point
 * and needs no override — but that requires a custom domain.) Same spirit as
 * GITHUB_APP_WEBHOOK_PROXY_URL: a dev-only escape hatch for a third party that can't
 * reach localhost. Leave it unset in production, where the derived value is correct.
 */
export function slackRedirectUri(): string | null {
  const override = process.env.SLACK_REDIRECT_URI?.trim();
  if (override) return override;
  const base = process.env.BETTER_AUTH_URL;
  const origin = base ? appOriginFor(base) : null;
  return origin ? new URL("/api/slack/oauth", origin).toString() : null;
}

/** Where to send the browser to install. Null when Slack isn't configured. */
export function slackInstallUrl(state: string): string | null {
  const config = slackConfig();
  const redirectUri = slackRedirectUri();
  if (!config || !redirectUri) return null;
  const url = new URL(OAUTH_AUTHORIZE);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("scope", REQUIRED_BOT_SCOPES.join(","));
  url.searchParams.set("state", state);
  url.searchParams.set("redirect_uri", redirectUri);
  return url.toString();
}

export type SlackInstallResult = {
  teamId: string;
  teamName: string;
  botUserId: string;
  botToken: string;
  scopes: string;
};

/** Trade the callback's `?code=` for the workspace's bot token (oauth.v2.access). */
export async function exchangeSlackCode(
  code: string,
): Promise<SlackInstallResult | { error: string }> {
  const config = slackConfig();
  const redirectUri = slackRedirectUri();
  if (!config || !redirectUri) return { error: "Slack isn't configured for this deployment." };
  const res = await fetch(OAUTH_ACCESS, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) return { error: `Slack rejected the authorization (${res.status}).` };
  // Slack returns 200 with ok:false on failure, so status alone isn't enough.
  const body = (await res.json()) as {
    ok: boolean;
    error?: string;
    access_token?: string;
    scope?: string;
    bot_user_id?: string;
    team?: { id?: string; name?: string };
  };
  if (!body.ok || !body.access_token || !body.team?.id || !body.bot_user_id) {
    return { error: body.error ?? "Slack returned no bot token." };
  }
  return {
    teamId: body.team.id,
    teamName: body.team.name ?? body.team.id,
    botUserId: body.bot_user_id,
    botToken: body.access_token,
    scopes: body.scope ?? "",
  };
}
