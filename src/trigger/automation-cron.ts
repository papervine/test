// The cron tick receiver (SPEC §10.2): Trigger.dev fires this on every registered
// automation schedule (externalId = automation id, registered by the executor
// adapter's syncCronSchedule). It re-checks intent in Postgres — the schedule is a
// projection, the row is the truth — then enqueues a normal automation run. A tick
// for a deleted/disabled/re-triggered automation self-cleans its stale schedule.
import { logger, schedules, tasks } from "@trigger.dev/sdk/v3";
import { eq } from "drizzle-orm";
import { db } from "../lib/db";
import { automation as automationTable } from "../lib/db/app-schema";
import { AUTOMATION_RUN_TASK_ID } from "../lib/automations/executor";
import { dbRunStore, enqueueAutomationRun } from "../lib/automations/runs";

export const automationCronTask = schedules.task({
  id: "automation-cron",
  run: async (payload) => {
    const automationId = payload.externalId;
    if (!automationId) {
      logger.warn("cron tick without an externalId — orphan schedule", {
        scheduleId: payload.scheduleId,
      });
      return { skipped: "no externalId" };
    }

    const [auto] = await db
      .select()
      .from(automationTable)
      .where(eq(automationTable.id, automationId))
      .limit(1);
    if (!auto || !auto.enabled || auto.triggerType !== "cron") {
      // Intent changed since registration (deleted / disabled / different trigger) and
      // the deregistration didn't land — converge by removing the schedule itself.
      await schedules.del(payload.scheduleId).catch(() => undefined);
      logger.log("stale schedule self-cleaned", { automationId, scheduleId: payload.scheduleId });
      return { skipped: "stale schedule" };
    }

    // The tick timestamp is the idempotency ref: a redelivered tick enqueues nothing.
    // Coerced defensively — real schedule ticks deliver a Date, but a manually
    // triggered test tick arrives as plain JSON with a string timestamp.
    const tickAt = new Date(payload.timestamp).toISOString();
    const result = await enqueueAutomationRun(
      auto,
      { triggerType: "cron", triggerRef: `cron-${tickAt}` },
      {
        store: dbRunStore(),
        // Inside the worker the SDK is runtime-authenticated — trigger directly
        // instead of going through getExecutor()'s TRIGGER_SECRET_KEY env check.
        executor: {
          enqueueRun: async ({ runId }) => {
            const handle = await tasks.trigger(AUTOMATION_RUN_TASK_ID, { runId });
            return { executorRunId: handle.id };
          },
        },
      },
    );
    logger.log("cron tick processed", { automationId, ...result });
    return result;
  },
});
