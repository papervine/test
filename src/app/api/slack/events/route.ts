import { after, type NextRequest } from "next/server";
import { verifySlackSignature, parseSlackDelivery } from "@/lib/slack-events";
import { slackConfig } from "@/lib/slack";
import { enqueueAgentRun } from "@/lib/agent-runs";

/**
 * Slack Events API endpoint (SPEC §10.2 Agent — the inbound half).
 *
 * Registered on the **apex** host (papervine.io/api/slack/events), like the GitHub
 * webhook and for the same reason: middleware passes /api/ straight through there, while
 * the app host would redirect Slack's unauthed POST to /login. Authorization is the
 * signing-secret HMAC over the raw body, never a session.
 *
 * Slack demands a 2xx within 3 seconds and retries anything else — but an agent answer
 * takes tens of seconds. So this route only *accepts* the delivery: verify, resolve,
 * persist an `agent_run` row (unique on the Slack event id, so a retry that races our
 * ack can't double-answer), enqueue the executor task, and return 200. The task owns the
 * model call and the reply. `after()` keeps the enqueue off the ack's critical path.
 */
export async function POST(req: NextRequest) {
  // Signature is over the RAW bytes — read text() and verify BEFORE parsing.
  const raw = await req.text();
  const ok = verifySlackSignature({
    rawBody: raw,
    timestamp: req.headers.get("x-slack-request-timestamp"),
    signature: req.headers.get("x-slack-signature"),
    signingSecret: slackConfig()?.signingSecret,
  });
  if (!ok) return new Response("bad signature", { status: 401 });

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("bad payload", { status: 400 });
  }

  const delivery = parseSlackDelivery(payload);

  // The endpoint handshake Slack runs when you save the Request URL.
  if (delivery?.kind === "url_verification") {
    return Response.json({ challenge: delivery.challenge });
  }
  // Anything we don't act on (the bot's own messages, edits, unknown events) is a quiet
  // 204 — never an error, which Slack would retry and eventually disable the endpoint for.
  if (!delivery) return new Response(null, { status: 204 });

  // Ack immediately; accept the work after the response. A failure in here must never
  // turn into a non-2xx (that would make Slack retry a delivery we may already have
  // persisted), so everything is caught and logged.
  after(async () => {
    try {
      // The bot's own @mention is stripped inside enqueueAgentRun — it needs the
      // workspace row to know the bot's user id, which is the same lookup that
      // resolves the org.
      const result = await enqueueAgentRun({
        teamId: delivery.teamId,
        eventId: delivery.eventId,
        channel: delivery.channel,
        threadTs: delivery.threadTs,
        userId: delivery.userId,
        text: delivery.text,
      });
      if (!result.ok && result.reason !== "duplicate" && result.reason !== "empty_prompt") {
        console.warn("[slack] agent run not enqueued:", result.reason, result.error ?? "");
      }
    } catch (err) {
      console.error("[slack] failed to accept an agent run:", err);
    }
  });

  return new Response(null, { status: 200 });
}
