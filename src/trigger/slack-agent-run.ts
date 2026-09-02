// The Slack agent run task (SPEC §10.2 Agent) — the interactive sibling of
// automation-run.ts.
//
// The events route can only ACK (Slack wants 2xx in 3 seconds); this does the work: read
// the org's docs with the same read tools the in-docs assistant uses, then answer in the
// Slack thread. Read-only by design in this slice — the agent answers questions; opening
// doc changes from a mention comes next, and will go through the §9.2 authoring backend
// exactly as automations do (never a parallel write path).
//
// Imports are relative (no @/ alias) and the build stubs `server-only` + `next/cache`
// (see trigger.config.ts) so the Next-tangled content stack loads in plain Node.
import { logger, task } from "@trigger.dev/sdk/v3";
import { generateText, stepCountIs } from "ai";
import { eq, sql } from "drizzle-orm";
import { db } from "../lib/db";
import { agentRun as agentRunTable, site as siteTable, usageEvent } from "../lib/db/app-schema";
import { getSlackWorkspaceByTeamId, botTokenFor } from "../lib/slack-workspaces";
import { postThreadMessage, updateMessage, fitSlackText } from "../lib/slack-api";
import { authorizeAi, recordAiUsage } from "../lib/billing/store";
import { assistantTools } from "@papervine/renderer/lib/assistant-tools";
import { contentContext } from "@papervine/renderer/lib/content";
import { s3Source } from "../lib/s3-source";
import { contentVersion, liveContentPrefix } from "../lib/revisions";
import { resolveDocsBaseUrl } from "../lib/widget";
import {
  aiModel,
  aiModelId,
  aiProviderOptions,
  aiProviderStatus,
} from "@papervine/renderer/lib/ai-model";

export const slackAgentRunTask = task({
  id: "slack-agent-run",
  // A conversational turn should feel like a chat reply, not a batch job — but tool loops
  // over a large corpus take time. Well short of automation-run's 1800.
  maxDuration: 300,
  // No retry: the answer is posted into a Slack thread, and a second attempt would post a
  // second reply to the same question. A failed turn says so in-thread instead.
  retry: { maxAttempts: 1 },
  run: async (payload: { runId: string }) => {
    const { runId } = payload;

    const [run] = await db
      .select()
      .from(agentRunTable)
      .where(eq(agentRunTable.id, runId))
      .limit(1);
    if (!run) throw new Error(`agent_run ${runId} not found`);
    if (run.status !== "queued") {
      logger.log("agent run is not queued; skipping", { runId, status: run.status });
      return { skipped: run.status };
    }

    const workspace = await getSlackWorkspaceByTeamId(run.slackTeamId);
    const [siteRow] = await db
      .select()
      .from(siteTable)
      .where(eq(siteTable.id, run.siteId))
      .limit(1);

    // Bot token in hand, we can always *say* what went wrong in the thread — which is the
    // difference between a visibly failed answer and a bot that silently ignores people.
    // Returns the delivery error (if any) so the caller can decide whether the run
    // actually succeeded: an answer nobody received is not a success.
    const botToken = workspace ? botTokenFor(workspace) : null;
    const say = async (text: string): Promise<string | null> => {
      if (!botToken) return "no bot token";
      const fitted = fitSlackText(text);
      const res = run.slackMessageTs
        ? await updateMessage({
            botToken,
            channel: run.slackChannelId,
            ts: run.slackMessageTs,
            text: fitted,
          })
        : await postThreadMessage({
            botToken,
            channel: run.slackChannelId,
            threadTs: run.slackThreadTs,
            text: fitted,
          });
      return "error" in res ? res.error : null;
    };

    const fail = async (error: string, userFacing?: string) => {
      await db
        .update(agentRunTable)
        .set({ status: "failed", error, finishedAt: new Date() })
        .where(eq(agentRunTable.id, runId));
      await say(userFacing ?? `Sorry — I couldn't answer that. (${error})`);
      logger.error("agent run failed", { runId, error });
      return { ok: false as const, error };
    };

    if (!workspace || !botToken) {
      // Either disconnected between the mention and this run, or the stored token can no
      // longer be decrypted (rotated encryption key / corrupt row — botTokenFor returns
      // null rather than throwing, so this stays a *visible* failed run instead of an
      // unhandled crash that leaves the row queued forever). Both mean there is nothing
      // to reply through, so the failure is recorded and nothing is posted.
      const error = !workspace
        ? "slack workspace is no longer connected"
        : "the stored Slack bot token could not be read — reconnect the workspace";
      await db
        .update(agentRunTable)
        .set({ status: "failed", error, finishedAt: new Date() })
        .where(eq(agentRunTable.id, runId));
      logger.error("agent run cannot reply", { runId, error });
      return { ok: false as const, error };
    }
    if (!siteRow) return fail("site no longer exists");

    const provider = aiProviderStatus(aiModelId("assistant"));
    if (!provider.ok) return fail(provider.error, "The docs agent isn't configured yet.");

    // Credit/entitlement gate — the agent follows the same entitlement as automations
    // (src/lib/billing/unlock.ts explains why they share one flag).
    const billing = await authorizeAi(siteRow.organizationId, "workflows");
    if (!billing.allowed) {
      return fail(
        billing.code === "out_of_credits" ? "out of AI credits" : "plan does not include the agent",
        billing.code === "out_of_credits"
          ? "This workspace is out of AI credits."
          : "This workspace's plan doesn't include the docs agent.",
      );
    }

    // Post the placeholder first: someone asked a question and deserves an immediate sign
    // of life. Its ts is the handle we edit into the answer, and it's persisted so a
    // failure path edits the same message instead of posting a second one.
    const placeholder = await postThreadMessage({
      botToken,
      channel: run.slackChannelId,
      threadTs: run.slackThreadTs,
      text: "_Reading the docs…_",
    });
    const messageTs = "ts" in placeholder ? placeholder.ts : null;

    await db
      .update(agentRunTable)
      .set({ status: "running", startedAt: new Date(), slackMessageTs: messageTs })
      .where(eq(agentRunTable.id, runId));
    if (messageTs) run.slackMessageTs = messageTs; // so `say` edits rather than re-posts

    try {
      const model = aiModelId("assistant");
      // The site's LIVE published content — the same bytes readers see. Not a draft
      // overlay: a Slack answer must reflect what's shipped, and this slice never writes.
      const source = s3Source(siteRow.id, contentVersion(siteRow), liveContentPrefix(siteRow));

      // The read tools return ROOT-RELATIVE hrefs (/guides/intro#anchor). In the browser
      // that's all the assistant needs; in Slack a relative href isn't a link at all, and
      // told to emit <url|label> the model will happily invent a host (it produced
      // `https://example.com/...` on the first live run). So hand it the site's real
      // public base — the same helper that mints the embeddable widget's citations, which
      // solved this exact problem (custom domain, else the configured tenant host).
      const docsBaseUrl = resolveDocsBaseUrl(
        // No request host in a background task; the deployment's own base URL is the
        // configuration-derived stand-in (dev → localhost, prod → the platform apex).
        new URL(process.env.BETTER_AUTH_URL ?? "https://papervine.io").host,
        siteRow,
      );

      const system =
        `You are the documentation agent for "${siteRow.name}", answering in Slack. ` +
        `Answer from the site's documentation using the read tools (searchDocs, readPage, ` +
        `listPages) — search before you answer, and never guess at product behavior the ` +
        `docs don't state. Reply in Slack mrkdwn: short paragraphs, *bold* not **bold**, ` +
        `links as <url|label>. The tools return root-relative hrefs; make them absolute ` +
        `against ${docsBaseUrl} and NEVER invent a different host. Be concise — a few ` +
        `sentences beats an essay — and link the pages you used. If the docs genuinely ` +
        `don't cover it, say so plainly and suggest what would need documenting.`;

      const result = await contentContext.run(source, async () =>
        generateText({
          model: aiModel(model),
          system,
          prompt: run.prompt,
          tools: assistantTools,
          stopWhen: stepCountIs(12),
          providerOptions: aiProviderOptions(model),
        }),
      );

      // Meter before reporting: the rollup below reads what this records.
      if (billing.metered) {
        await recordAiUsage({
          organizationId: siteRow.organizationId,
          siteId: siteRow.id,
          feature: "workflows",
          model,
          tokensIn: result.totalUsage.inputTokens ?? 0,
          tokensOut: result.totalUsage.outputTokens ?? 0,
          requestId: runId,
        });
      }
      const [{ credits }] = await db
        .select({ credits: sql<number>`coalesce(sum(${usageEvent.credits}), 0)` })
        .from(usageEvent)
        .where(eq(usageEvent.requestId, runId));

      const answer = result.text.trim();
      if (!answer) return fail("the model returned an empty answer");

      // Delivery is part of the job. An answer we generated (and billed for) but could
      // not post is a FAILED run, not a successful one — reporting success there would
      // leave a "succeeded" row in the history for a question the human never saw an
      // answer to. The answer is still recorded so the failure is diagnosable.
      const deliveryError = await say(answer);
      await db
        .update(agentRunTable)
        .set({
          status: deliveryError ? "failed" : "succeeded",
          answer: answer.slice(0, 4000),
          error: deliveryError ? `answer generated but not delivered: ${deliveryError}` : null,
          creditsUsed: credits,
          finishedAt: new Date(),
        })
        .where(eq(agentRunTable.id, runId));
      if (deliveryError) {
        logger.error("agent run could not deliver its answer", { runId, deliveryError, credits });
        return { ok: false as const, error: deliveryError };
      }
      logger.log("agent run succeeded", { runId, credits });
      return { ok: true as const, credits };
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  },
});
