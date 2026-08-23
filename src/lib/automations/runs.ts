// Run lifecycle service (SPEC §10.2): creates automation_run rows (intent) and hands
// them to the executor projection. Store + executor are injectable so the decision
// logic unit-tests with no DB and no Trigger.dev (the domain-reconcile pattern);
// production callers use the drizzle-backed defaults. Deliberately NOT `server-only`:
// the Trigger.dev task imports this module too.
import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { automation, automationRun, site } from "@/lib/db/app-schema";
import { getCatalogEntry } from "./catalog";
import { getExecutor, type AutomationExecutor } from "./executor";

export type AutomationRow = typeof automation.$inferSelect;
export type AutomationRunRow = typeof automationRun.$inferSelect;

export type RunTriggerType = "content_update" | "cron" | "code_change" | "manual";

// The triggering push for a code_change run — the task reads it off the run row to build
// its prompt and scope the trigger-repo read tool (SPEC §10.2).
export type TriggerContext = { repo: string; sha: string; changedFiles: string[] };

export type RunStore = {
  findRunByTrigger(
    automationId: string,
    triggerType: RunTriggerType,
    triggerRef: string,
  ): Promise<{ id: string } | null>;
  // Runs in the last 24h that actually reached the model. Failed-before-spending runs
  // are excluded so a broken automation can keep retrying while a *spending* one
  // can't run away (the reference's "failed runs don't count" rule).
  countBillableRunsSince(automationId: string, since: Date): Promise<number>;
  // The content sha the automation's most recent SUCCESSFUL run saw, or null if it has
  // never succeeded. Drives the skip-unchanged guard.
  lastSucceededSourceSha(automationId: string): Promise<string | null>;
  // The site's current head sha (what a run would read right now).
  siteSourceSha(siteId: string): Promise<string | null>;
  insertRun(row: {
    id: string;
    automationId: string;
    siteId: string;
    triggerType: RunTriggerType;
    triggerRef: string | null;
    sourceSha: string | null;
    triggerContext?: TriggerContext | null;
  }): Promise<void>;
  updateRun(
    id: string,
    patch: Partial<
      Pick<
        AutomationRunRow,
        | "status"
        | "executorRunId"
        | "resultRef"
        | "summary"
        | "error"
        | "creditsUsed"
        | "startedAt"
        | "finishedAt"
      >
    >,
  ): Promise<void>;
  listEnabledAutomations(siteId: string, triggerType: RunTriggerType): Promise<AutomationRow[]>;
  // Enabled code_change automations in `organizationId` whose triggerRepos include
  // `repo` ("owner/name"). Org-scoped so two tenants that both reference the same public
  // repo don't cross-trigger each other (SPEC §10.2).
  listCodeChangeAutomationsForRepo(repo: string, organizationId: string): Promise<AutomationRow[]>;
};

export function dbRunStore(): RunStore {
  return {
    async findRunByTrigger(automationId, triggerType, triggerRef) {
      const rows = await db
        .select({ id: automationRun.id })
        .from(automationRun)
        .where(
          and(
            eq(automationRun.automationId, automationId),
            eq(automationRun.triggerType, triggerType),
            eq(automationRun.triggerRef, triggerRef),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },
    async insertRun(row) {
      await db.insert(automationRun).values(row);
    },
    async countBillableRunsSince(automationId, since) {
      const [row] = await db
        .select({ n: sql<number>`count(*)` })
        .from(automationRun)
        .where(
          and(
            eq(automationRun.automationId, automationId),
            gte(automationRun.queuedAt, since),
            // Anything that isn't a pre-model failure: succeeded/running/queued, or a
            // failure that already burned credits.
            sql`(${automationRun.status} <> 'failed' or ${automationRun.creditsUsed} > 0)`,
          ),
        );
      return Number(row?.n ?? 0);
    },
    async lastSucceededSourceSha(automationId) {
      const [row] = await db
        .select({ sha: automationRun.sourceSha })
        .from(automationRun)
        .where(
          and(
            eq(automationRun.automationId, automationId),
            eq(automationRun.status, "succeeded"),
          ),
        )
        .orderBy(desc(automationRun.queuedAt))
        .limit(1);
      return row?.sha ?? null;
    },
    async siteSourceSha(siteId) {
      const [row] = await db
        .select({ sha: site.lastSyncedCommitSha })
        .from(site)
        .where(eq(site.id, siteId))
        .limit(1);
      return row?.sha ?? null;
    },
    async updateRun(id, patch) {
      await db.update(automationRun).set(patch).where(eq(automationRun.id, id));
    },
    async listEnabledAutomations(siteId, triggerType) {
      return db
        .select()
        .from(automation)
        .where(
          and(
            eq(automation.siteId, siteId),
            eq(automation.enabled, true),
            eq(automation.triggerType, triggerType),
          ),
        );
    },
    async listCodeChangeAutomationsForRepo(repo, organizationId) {
      // Pull the org's enabled code_change automations (few per org) and match the repo
      // in JS, case-insensitively — GitHub repo names are case-insensitive and the user
      // types triggerRepos freehand, so a jsonb `@>` exact match would miss casing.
      const repoLc = repo.toLowerCase();
      const rows = await db
        .select({ automation })
        .from(automation)
        .innerJoin(site, eq(site.id, automation.siteId))
        .where(
          and(
            eq(site.organizationId, organizationId),
            eq(automation.enabled, true),
            eq(automation.triggerType, "code_change"),
          ),
        );
      return rows
        .map((r) => r.automation)
        .filter((a) =>
          ((a.triggerRepos as string[] | null) ?? []).some((t) => t.toLowerCase() === repoLc),
        );
    },
  };
}

export type EnqueueDeps = {
  store: RunStore;
  executor: Pick<AutomationExecutor, "enqueueRun"> | null;
};

export type EnqueueResult =
  | { ok: true; runId: string }
  | {
      ok: false;
      reason:
        | "duplicate"
        | "executor_unconfigured"
        | "enqueue_failed"
        | "daily_cap"
        | "unchanged";
      error?: string;
    };

// Matches the reference's cap (500 runs/day/automation, failures excluded). High enough
// that no sane schedule hits it, low enough that a runaway stops within a day instead of
// draining an account — a per-minute cron caps out after ~8 hours. Overridable per
// deployment.
export const DAILY_RUN_CAP = Number(process.env.AUTOMATION_DAILY_RUN_CAP ?? 500);

// Create + enqueue one run. Idempotent on (automation, triggerType, triggerRef): a
// redelivered webhook or double-fired sync enqueues nothing the second time. With no
// executor configured nothing is persisted — no zombie queued rows; callers surface
// "not configured" instead. If the executor rejects the enqueue, the run row IS kept,
// marked failed, so the failure is visible in run history rather than swallowed.
export async function enqueueAutomationRun(
  auto: Pick<AutomationRow, "id" | "siteId" | "catalogKey">,
  opts: {
    triggerType: RunTriggerType;
    triggerRef?: string | null;
    triggerContext?: TriggerContext | null;
  },
  deps: EnqueueDeps = { store: dbRunStore(), executor: getExecutor() },
): Promise<EnqueueResult> {
  if (!deps.executor) return { ok: false, reason: "executor_unconfigured" };

  const triggerRef = opts.triggerRef ?? null;
  if (triggerRef) {
    const existing = await deps.store.findRunByTrigger(auto.id, opts.triggerType, triggerRef);
    if (existing) return { ok: false, reason: "duplicate" };
  }

  // A human clicking Run now always gets a run — the guards below exist to bound
  // *unattended* spend, and a manual click is neither unattended nor repeating.
  const automated = opts.triggerType !== "manual";
  const sourceSha = await deps.store.siteSourceSha(auto.siteId);

  if (automated) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const spent = await deps.store.countBillableRunsSince(auto.id, since);
    if (spent >= DAILY_RUN_CAP) return { ok: false, reason: "daily_cap" };

    // Skip-unchanged: an automation that reads only the site's own docs has nothing to
    // do when those docs haven't moved since its last success. This is the difference
    // between a nightly cron costing ~$0.08 every night forever and costing nothing
    // until someone actually edits the docs. Automations with external inputs (a source
    // repo, assistant logs, reader feedback) always run — their input changes without
    // the docs changing.
    const entry = getCatalogEntry(auto.catalogKey);
    const docsOnly = !!entry && !entry.inputs.includes("external");
    if (docsOnly && sourceSha) {
      const lastSha = await deps.store.lastSucceededSourceSha(auto.id);
      if (lastSha && lastSha === sourceSha) return { ok: false, reason: "unchanged" };
    }
  }

  const runId = randomUUID();
  await deps.store.insertRun({
    id: runId,
    automationId: auto.id,
    siteId: auto.siteId,
    triggerType: opts.triggerType,
    triggerRef,
    sourceSha,
    triggerContext: opts.triggerContext ?? null,
  });

  try {
    const { executorRunId } = await deps.executor.enqueueRun({ runId });
    await deps.store.updateRun(runId, { executorRunId });
    return { ok: true, runId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await deps.store.updateRun(runId, {
      status: "failed",
      error: `enqueue failed: ${message}`,
      finishedAt: new Date(),
    });
    return { ok: false, reason: "enqueue_failed", error: message };
  }
}

// Converge the executor's cron schedule to an automation's config and persist the
// resulting schedule handle. Called after every config mutation (save / toggle /
// delete). No executor → no-op (the page's "not configured" banner covers messaging).
// Returns ok:false with the executor's error when convergence fails — the config is
// already saved, so callers surface it as a warning, not a rollback.
export async function syncAutomationSchedule(
  auto: Pick<
    AutomationRow,
    "id" | "enabled" | "triggerType" | "cronExpression" | "executorScheduleId"
  >,
  deps: {
    executor: Pick<AutomationExecutor, "syncCronSchedule"> | null;
    persist: (scheduleId: string | null) => Promise<void>;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!deps.executor) return { ok: true };
  try {
    const scheduleId = await deps.executor.syncCronSchedule({
      automationId: auto.id,
      enabled: auto.enabled,
      triggerType: auto.triggerType,
      cronExpression: auto.cronExpression,
      existingScheduleId: auto.executorScheduleId,
    });
    if (scheduleId !== auto.executorScheduleId) await deps.persist(scheduleId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function dbSchedulePersist(automationId: string) {
  return async (scheduleId: string | null) => {
    await db
      .update(automation)
      .set({ executorScheduleId: scheduleId, updatedAt: new Date() })
      .where(eq(automation.id, automationId));
  };
}

// The content_update fan-out, called from the sync success path. Must never throw —
// a broken automations layer can't be allowed to fail a sync — and never fires the
// same commit twice (enqueueAutomationRun's triggerRef idempotency). This is also the
// self-trigger loop breaker: an automation's own commit re-syncs under a sha that
// already has a run row.
export async function fireContentUpdateAutomations(
  siteId: string,
  /**
   * The idempotency key for this content change: a commit sha where there is one, else
   * something else that's STABLE for this deployment (the deployment id). It must never be
   * freshly random — that's what defeats the self-trigger loop breaker below.
   */
  ref: string | null,
  deps: EnqueueDeps = { store: dbRunStore(), executor: getExecutor() },
): Promise<void> {
  try {
    // No executor → nothing to do; skip the query entirely (keeps no-DB smoke paths quiet).
    if (!deps.executor) return;
    const autos = await deps.store.listEnabledAutomations(siteId, "content_update");
    for (const a of autos) {
      const result = await enqueueAutomationRun(
        a,
        // A commit-less content change (a manual re-sync, a Papervine-hosted publish)
        // supplies its deployment id instead, so a RETRY of the same publish dedupes while
        // two genuinely different publishes don't. The old per-fire `randomUUID()` fallback
        // was a fresh key every time, which defeated the loop breaker above entirely — an
        // automation that published would re-trigger itself until the daily cap stopped it.
        { triggerType: "content_update", triggerRef: ref ?? `manual-sync-${randomUUID()}` },
        deps,
      );
      if (!result.ok && result.reason === "enqueue_failed") {
        console.error(`[automations] enqueue failed site=${siteId} automation=${a.id}: ${result.error}`);
      } else if (!result.ok && result.reason === "daily_cap") {
        // Visible in logs rather than silent: a capped automation is a misconfiguration
        // (or an attack on your own wallet), and the operator should be able to find out.
        console.warn(
          `[automations] daily run cap (${DAILY_RUN_CAP}) reached site=${siteId} automation=${a.id}`,
        );
      }
    }
  } catch (err) {
    console.error(`[automations] content_update fan-out failed site=${siteId}:`, err);
  }
}

// The code_change fan-out, called from the GitHub push webhook. `repo` is "owner/name"
// of the pushed source repo; `organizationId` comes from the push's installation.id →
// github_installation. Mirrors fireContentUpdateAutomations: never throws (a broken
// automations layer can't be allowed to 500 the webhook), no-op without an executor,
// idempotent per commit sha. The change context rides onto each run row so the task can
// tell the agent what changed and read the trigger repo at that sha.
export async function fireCodeChangeAutomations(
  repo: string,
  organizationId: string,
  change: TriggerContext,
  deps: EnqueueDeps = { store: dbRunStore(), executor: getExecutor() },
): Promise<void> {
  try {
    if (!deps.executor) return;
    const autos = await deps.store.listCodeChangeAutomationsForRepo(repo, organizationId);
    for (const a of autos) {
      const result = await enqueueAutomationRun(
        a,
        { triggerType: "code_change", triggerRef: change.sha, triggerContext: change },
        deps,
      );
      if (!result.ok && result.reason === "enqueue_failed") {
        console.error(`[automations] code_change enqueue failed automation=${a.id}: ${result.error}`);
      } else if (!result.ok && result.reason === "daily_cap") {
        console.warn(`[automations] daily run cap (${DAILY_RUN_CAP}) reached automation=${a.id}`);
      }
    }
  } catch (err) {
    console.error(`[automations] code_change fan-out failed repo=${repo}:`, err);
  }
}
