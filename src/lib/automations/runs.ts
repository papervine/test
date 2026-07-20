// Run lifecycle service (SPEC §10.2): creates automation_run rows (intent) and hands
// them to the executor projection. Store + executor are injectable so the decision
// logic unit-tests with no DB and no Trigger.dev (the domain-reconcile pattern);
// production callers use the drizzle-backed defaults. Deliberately NOT `server-only`:
// the Trigger.dev task imports this module too.
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { automation, automationRun } from "@/lib/db/app-schema";
import { getExecutor, type AutomationExecutor } from "./executor";

export type AutomationRow = typeof automation.$inferSelect;
export type AutomationRunRow = typeof automationRun.$inferSelect;

export type RunTriggerType = "content_update" | "cron" | "code_change" | "manual";

export type RunStore = {
  findRunByTrigger(
    automationId: string,
    triggerType: RunTriggerType,
    triggerRef: string,
  ): Promise<{ id: string } | null>;
  insertRun(row: {
    id: string;
    automationId: string;
    siteId: string;
    triggerType: RunTriggerType;
    triggerRef: string | null;
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
  };
}

export type EnqueueDeps = {
  store: RunStore;
  executor: Pick<AutomationExecutor, "enqueueRun"> | null;
};

export type EnqueueResult =
  | { ok: true; runId: string }
  | { ok: false; reason: "duplicate" | "executor_unconfigured" | "enqueue_failed"; error?: string };

// Create + enqueue one run. Idempotent on (automation, triggerType, triggerRef): a
// redelivered webhook or double-fired sync enqueues nothing the second time. With no
// executor configured nothing is persisted — no zombie queued rows; callers surface
// "not configured" instead. If the executor rejects the enqueue, the run row IS kept,
// marked failed, so the failure is visible in run history rather than swallowed.
export async function enqueueAutomationRun(
  auto: Pick<AutomationRow, "id" | "siteId">,
  opts: { triggerType: RunTriggerType; triggerRef?: string | null },
  deps: EnqueueDeps = { store: dbRunStore(), executor: getExecutor() },
): Promise<EnqueueResult> {
  if (!deps.executor) return { ok: false, reason: "executor_unconfigured" };

  const triggerRef = opts.triggerRef ?? null;
  if (triggerRef) {
    const existing = await deps.store.findRunByTrigger(auto.id, opts.triggerType, triggerRef);
    if (existing) return { ok: false, reason: "duplicate" };
  }

  const runId = randomUUID();
  await deps.store.insertRun({
    id: runId,
    automationId: auto.id,
    siteId: auto.siteId,
    triggerType: opts.triggerType,
    triggerRef,
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
  commitSha: string | null,
  deps: EnqueueDeps = { store: dbRunStore(), executor: getExecutor() },
): Promise<void> {
  try {
    // No executor → nothing to do; skip the query entirely (keeps no-DB smoke paths quiet).
    if (!deps.executor) return;
    const autos = await deps.store.listEnabledAutomations(siteId, "content_update");
    for (const a of autos) {
      const result = await enqueueAutomationRun(
        a,
        // A manual sync has no commit sha; fall back to a per-fire ref so it still runs
        // (and a retried manual sync isn't deduped away against a real commit's run).
        { triggerType: "content_update", triggerRef: commitSha ?? `manual-sync-${randomUUID()}` },
        deps,
      );
      if (!result.ok && result.reason === "enqueue_failed") {
        console.error(`[automations] enqueue failed site=${siteId} automation=${a.id}: ${result.error}`);
      }
    }
  } catch (err) {
    console.error(`[automations] content_update fan-out failed site=${siteId}:`, err);
  }
}
