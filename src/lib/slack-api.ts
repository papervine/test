import "server-only";
import { WebClient } from "@slack/web-api";

/**
 * Outbound Slack calls (SPEC §10.2). Thin on purpose — the agent needs three things:
 * post a placeholder, edit it into the answer, and (on a hard failure) say so.
 *
 * Why `@slack/web-api` rather than hand-rolled fetch (which is this repo's usual style
 * for third-party APIs — see github-app.ts): **post-and-edit is rate-limit-sensitive**.
 * `chat.update` is tier-limited per channel, and an agent that edits its message as it
 * works will brush those limits; the official client already implements Slack's
 * retry/backoff semantics, which is exactly the wheel not worth rebuilding. It is also
 * the client `@chat-adapter/slack` itself depends on — see the §18 note on why we take
 * the transport directly rather than the adapter's handler/state model.
 *
 * One client per call, not a module singleton: each call is for a *different tenant's*
 * bot token, and a shared client would need the token threaded through anyway.
 */
function client(botToken: string): WebClient {
  return new WebClient(botToken, {
    // The client retries 429s on its own; keep the ceiling low so a rate-limited edit
    // can't hold a Trigger.dev run open for minutes.
    retryConfig: { retries: 3 },
  });
}

/** Post into a thread. Returns the message ts — the handle `updateMessage` edits. */
export async function postThreadMessage(input: {
  botToken: string;
  channel: string;
  threadTs: string;
  text: string;
}): Promise<{ ts: string } | { error: string }> {
  try {
    const res = await client(input.botToken).chat.postMessage({
      channel: input.channel,
      thread_ts: input.threadTs,
      text: input.text,
      // Markdown from the model renders as Slack mrkdwn well enough for links/bold;
      // unfurling every doc link the agent cites would bury the answer.
      unfurl_links: false,
      unfurl_media: false,
    });
    return res.ts ? { ts: res.ts } : { error: "Slack accepted the post but returned no ts" };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** Edit a message we posted (the placeholder → the answer). */
export async function updateMessage(input: {
  botToken: string;
  channel: string;
  ts: string;
  text: string;
}): Promise<{ ok: true } | { error: string }> {
  try {
    await client(input.botToken).chat.update({
      channel: input.channel,
      ts: input.ts,
      text: input.text,
    });
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Slack's message text cap is 4000 characters; an over-long answer is rejected outright
 * rather than truncated, which would turn a good answer into no answer at all.
 */
export const SLACK_TEXT_LIMIT = 3900;

export function fitSlackText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= SLACK_TEXT_LIMIT) return trimmed;
  return `${trimmed.slice(0, SLACK_TEXT_LIMIT - 1)}…`;
}
