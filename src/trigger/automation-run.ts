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
import { applyOutcome } from "../lib/automations/apply";
import { buildRunPrompt } from "../lib/automations/prompt";
import { checkoutBranch, discardSession, publishDraft } from "../lib/authoring-core";
import { publishResultRef } from "../lib/publish-mode";
import { isNativeSite, hasGitRepo } from "../lib/site-source";
import { authoringTools, draftContentSource } from "../lib/authoring-tools";
import { assistantTools } from "../lib/assistant-tools";
import { findOpenSession, listDraftFiles } from "../lib/draft-store";
import { authorizeAi, recordAiUsage } from "../lib/billing/store";
import { aiModel, aiModelId, aiProviderOptions, aiProviderStatus } from "../lib/ai-model";
import { getInstallationToken } from "../lib/github-app";
import { repoReadTools } from "../lib/automations/repo-tools";
import { contentContext } from "@papervine/renderer/lib/content";
import { triggerActivity } from "../lib/realtime";

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
      await triggerActivity(run.siteId);
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
      await triggerActivity(run.siteId);
      return { ok: false as const, canceled: true };
    }
    // A Papervine-hosted site has no repo BY DESIGN and publishes to storage instead, so
    // only a Git site missing its repo is a misconfiguration. (Reading context repos is
    // gated separately, on githubInstallationId, below.)
    if (!isNativeSite(siteRow) && !hasGitRepo(siteRow)) {
      return fail("site has no connected repo");
    }
    const provider = aiProviderStatus(aiModelId("automations"));
    if (!provider.ok) return fail(provider.error);

    // Repos the agent may READ this run (SPEC §10.2): configured context repos plus, for
    // a code_change run, the source repo whose push triggered it (or, for a manual run of
    // a code_change automation, its trigger repos at default branch). Reading any of them
    // needs the org's GitHub App installation token — the App is the access grant.
    const change =
      (run.triggerContext as { repo: string; sha: string; changedFiles: string[] } | null) ?? null;
    const contextRepos = (auto.contextRepos as string[] | null) ?? [];
    const triggerRepos = (auto.triggerRepos as string[] | null) ?? [];
    const readableRepos = Array.from(
      new Set([...contextRepos, ...(change ? [change.repo] : triggerRepos)]),
    );

    let repoToken: string | undefined;
    if (readableRepos.length > 0) {
      if (siteRow.githubInstallationId == null) {
        return fail(
          "this automation reads other repositories (code-change trigger or context repos), which requires the site to be connected with the GitHub App",
        );
      }
      repoToken = await getInstallationToken(siteRow.githubInstallationId);
      if (!repoToken) {
        return fail("could not obtain a GitHub App token to read the source/context repositories");
      }
    }

    const prompt = buildRunPrompt({
      catalogKey: auto.catalogKey,
      name: auto.name,
      additionalPrompt: auto.additionalPrompt,
      extras: (auto.extras ?? null) as Record<string, unknown> | null,
      triggerContext: run.triggerRef ? `${run.triggerType} @ ${run.triggerRef}` : run.triggerType,
      change,
      readableRepos: readableRepos.length ? readableRepos : null,
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
      // Keep the run's own copy of its instructions — config edits later must not
      // rewrite history (the run-detail view shows this).
      .set({ status: "running", startedAt: new Date(), prompt })
      .where(eq(automationRunTable.id, runId));
    await triggerActivity(run.siteId);

    const title =
      auto.catalogKey === CUSTOM_KEY
        ? (auto.name ?? "Custom automation")
        : (getCatalogEntry(auto.catalogKey)?.title ?? auto.catalogKey);

    // Every run gets its own session branch through the shared authoring backend
    // (§9.2) — the same session-branch + draft-buffer path as the human editor, never
    // a parallel write path.
    const { branch } = await checkoutBranch(siteRow, { actorUserId: null });

    try {
      // Automations write docs that land in Git — they may run a stronger model than
      // the high-volume assistant (PAPERVINE_AI_MODEL_AUTOMATIONS, ai-model.ts).
      const model = aiModelId("automations");
      // The agent drafts; it never publishes. Publishing is the deterministic apply
      // step below, governed by applyMode — so drop the session-management tools.
      const { write_page, edit_page, delete_page } = authoringTools(siteRow, branch);
      // Read-only tools over the automation's source/context repos, at the trigger sha
      // for the pushed repo and default branch otherwise. Absent when nothing's readable.
      const repoTools =
        repoToken && readableRepos.length
          ? repoReadTools({
              token: repoToken,
              allowed: readableRepos,
              refFor: (r) =>
                change && r.toLowerCase() === change.repo.toLowerCase() ? change.sha : undefined,
            })
          : {};
      const system =
        `You are running the "${title}" automation for a documentation site. ` +
        `Work autonomously: read the docs with the read tools (searchDocs, readPage, listPages), ` +
        (readableRepos.length
          ? `read the configured source/context repositories with list_repo_files and read_repo_file, `
          : "") +
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
            tools: { ...assistantTools, write_page, edit_page, delete_page, ...repoTools },
            stopWhen: stepCountIs(24),
            // Per-provider tuning (prompt caching, local-model reasoning) — ai-model.ts.
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

      const summary = result.text.trim().slice(0, 2000) || null;

      // Apply: what happens to the buffered draft at run end, per applyMode (apply.ts):
      //   no_changes → discard, succeed with no commit;
      //   commit     → publish straight to the deploy branch;
      //   review     → leave the session OPEN for in-app review — the run ends `review_needed`
      //                and Accept (dashboard) commits it later, Reject discards it.
      const session = await findOpenSession(siteRow.id, branch);
      const drafts = session ? await listDraftFiles(session.id) : [];
      const changedFiles = drafts.map((d) => d.path);
      const outcome = applyOutcome({ applyMode: auto.applyMode, draftCount: drafts.length });

      if (outcome === "review") {
        await db
          .update(automationRunTable)
          .set({
            status: "review_needed",
            reviewBranch: branch, // the still-open session the dashboard reviews + accepts/rejects
            summary,
            changedFiles,
            creditsUsed: credits,
            finishedAt: new Date(),
          })
          .where(eq(automationRunTable.id, runId));
        await triggerActivity(run.siteId);
        logger.log("automation run needs review", { runId, branch, credits, drafts: drafts.length });
        return { ok: true as const, reviewNeeded: true, credits };
      }

      let resultRef: string | null = null;
      if (outcome === "no_changes") {
        if (session) await discardSession(siteRow, branch);
      } else {
        const published = await publishDraft(siteRow, branch, {
          mode: "commit",
          message: `[automation] ${title}`,
          actorUserId: null,
          // An automation publishing must NOT fan out content_update automations — on a
          // Papervine-hosted site there's no commit sha to dedupe on, so this automation
          // would re-trigger itself until the daily run cap stopped it.
          origin: "automation",
        });
        if (!published.ok) {
          await db
            .update(automationRunTable)
            .set({ creditsUsed: credits, summary, changedFiles })
            .where(eq(automationRunTable.id, runId));
          return fail(
            published.conflict
              ? "publish conflict: the deploy branch moved during the run"
              : (published.error ?? "publish failed"),
          );
        }
        // A commit sha, a PR URL, or null on a Papervine-hosted site, which has neither —
        // its deployment row is the record of the publish.
        resultRef = publishResultRef(published);
      }

      await db
        .update(automationRunTable)
        .set({
          status: "succeeded",
          resultRef,
          summary,
          changedFiles,
          creditsUsed: credits,
          finishedAt: new Date(),
        })
        .where(eq(automationRunTable.id, runId));
      await triggerActivity(run.siteId);
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
