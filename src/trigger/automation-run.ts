// The automation run task (SPEC §10.2) — the executor half of the run primitive.
// Trigger.dev invokes this with a persisted automation_run id; everything it does is
// reflected back onto that row, so the run history is complete even if this process
// dies (Trigger.dev retries are off: a failed agent run is a visible failed run, not
// a silent replay). Imports are relative (no @/ alias) and the build stubs
// `server-only` + `next/cache` (see trigger.config.ts) so the Next-tangled authoring
// stack loads in plain Node.
import { logger, task } from "@trigger.dev/sdk/v3";
import { generateText, stepCountIs } from "ai";
import { eq, sql } from "drizzle-orm";
import { db } from "../lib/db";
import {
  automation as automationTable,
  automationRun as automationRunTable,
  site as siteTable,
  usageEvent,
} from "../lib/db/app-schema";
import { CUSTOM_KEY, getCatalogEntry } from "../lib/automations/catalog";
import { buildRunPrompt } from "../lib/automations/prompt";
import { checkoutBranch, discardSession, publishDraft } from "../lib/authoring-core";
import { authoringTools, draftContentSource } from "../lib/authoring-tools";
import { assistantTools } from "../lib/assistant-tools";
import { findOpenSession, listDraftFiles } from "../lib/draft-store";
import { authorizeAi, recordAiUsage } from "../lib/billing/store";
import { aiModel, aiModelId, aiProviderStatus } from "../lib/ai-model";
import { contentContext } from "@papervine/renderer/lib/content";

export const automationRunTask = task({
  id: "automation-run",
  maxDuration: 1800,
  retry: { maxAttempts: 1 },
  run: async (payload: { runId: string }) => {
    const { runId } = payload;

    const [run] = await db
      .select()
      .from(automationRunTable)
      .where(eq(automationRunTable.id, runId))
      .limit(1);
    if (!run) throw new Error(`automation_run ${runId} not found`);
    if (run.status !== "queued") {
      logger.log("run is not queued; skipping", { runId, status: run.status });
      return { skipped: run.status };
    }

    const [auto] = await db
      .select()
      .from(automationTable)
      .where(eq(automationTable.id, run.automationId))
      .limit(1);
    const [siteRow] = auto
      ? await db.select().from(siteTable).where(eq(siteTable.id, run.siteId)).limit(1)
      : [undefined];

    const fail = async (error: string) => {
      await db
        .update(automationRunTable)
        .set({ status: "failed", error, finishedAt: new Date() })
        .where(eq(automationRunTable.id, runId));
      logger.error("automation run failed", { runId, error });
      return { ok: false as const, error };
    };

    if (!auto || !siteRow) return fail("automation or site no longer exists");
    // Disabled between enqueue and execution (or mid-queue) — don't run stale intent.
    if (!auto.enabled) {
      await db
        .update(automationRunTable)
        .set({ status: "canceled", error: "automation disabled", finishedAt: new Date() })
        .where(eq(automationRunTable.id, runId));
      return { ok: false as const, canceled: true };
    }
    if (!siteRow.repoOwner || !siteRow.repoName) return fail("site has no connected repo");
    const provider = aiProviderStatus();
    if (!provider.ok) return fail(provider.error);

    const prompt = buildRunPrompt({
      catalogKey: auto.catalogKey,
      name: auto.name,
      additionalPrompt: auto.additionalPrompt,
      extras: (auto.extras ?? null) as Record<string, unknown> | null,
      triggerContext: run.triggerRef ? `${run.triggerType} @ ${run.triggerRef}` : run.triggerType,
    });
    if (!prompt) return fail("automation has no effective prompt");

    // Credit/entitlement gate — same as every AI surface (SPEC §10 Billing).
    const billing = await authorizeAi(siteRow.organizationId, "workflows");
    if (!billing.allowed) {
      return fail(
        billing.code === "out_of_credits"
          ? "out of AI credits"
          : "plan does not include automations",
      );
    }

    await db
      .update(automationRunTable)
      .set({ status: "running", startedAt: new Date() })
      .where(eq(automationRunTable.id, runId));

    const title =
      auto.catalogKey === CUSTOM_KEY
        ? (auto.name ?? "Custom automation")
        : (getCatalogEntry(auto.catalogKey)?.title ?? auto.catalogKey);

    // Every run gets its own session branch through the shared authoring backend
    // (§9.2) — the same session-branch + draft-buffer path as the human editor, never
    // a parallel write path.
    const { branch } = await checkoutBranch(siteRow, { actorUserId: null });

    try {
      const model = aiModelId();
      // The agent drafts; it never publishes. Publishing is the deterministic apply
      // step below, governed by applyMode — so drop the session-management tools.
      const { write_page, edit_page, delete_page } = authoringTools(siteRow, branch);
      const system =
        `You are running the "${title}" automation for a documentation site. ` +
        `Work autonomously: read the docs with the read tools (searchDocs, readPage, listPages), ` +
        `then make the required changes with write_page / edit_page / delete_page. ` +
        `Edits buffer on a draft branch; they are applied after you finish — never mention ` +
        `publishing. Make the smallest set of changes that completes the task. If nothing ` +
        `needs changing, change nothing. When done, reply with a one-paragraph summary of ` +
        `exactly what you changed and why (or state that no changes were needed).`;

      const result = await contentContext.run(
        draftContentSource(siteRow, branch),
        async () =>
          generateText({
            model: aiModel(model),
            system,
            prompt,
            tools: { ...assistantTools, write_page, edit_page, delete_page },
            stopWhen: stepCountIs(24),
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

      const summary = result.text.trim().slice(0, 2000) || null;

      // Apply: drafts → git through publishDraft, per applyMode. No drafts = a valid
      // "nothing needed doing" success with resultRef null.
      const session = await findOpenSession(siteRow.id, branch);
      const drafts = session ? await listDraftFiles(session.id) : [];
      let resultRef: string | null = null;
      if (drafts.length === 0) {
        if (session) await discardSession(siteRow, branch);
      } else {
        const published = await publishDraft(siteRow, branch, {
          mode: auto.applyMode === "auto" ? "commit" : "pr",
          message: `[automation] ${title}`,
          actorUserId: null,
        });
        if (!published.ok) {
          await db
            .update(automationRunTable)
            .set({ creditsUsed: credits, summary })
            .where(eq(automationRunTable.id, runId));
          return fail(
            published.conflict
              ? "publish conflict: the deploy branch moved during the run"
              : (published.error ?? "publish failed"),
          );
        }
        resultRef = published.mode === "commit" ? published.commitSha : published.prUrl;
      }

      await db
        .update(automationRunTable)
        .set({
          status: "succeeded",
          resultRef,
          summary,
          creditsUsed: credits,
          finishedAt: new Date(),
        })
        .where(eq(automationRunTable.id, runId));
      logger.log("automation run succeeded", { runId, resultRef, credits, drafts: drafts.length });
      return { ok: true as const, resultRef, credits };
    } catch (err) {
      // Leave no orphaned draft session behind a crashed run.
      try {
        await discardSession(siteRow, branch);
      } catch {
        // best-effort cleanup
      }
      return fail(err instanceof Error ? err.message : String(err));
    }
  },
});
