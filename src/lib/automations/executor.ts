// The executor seam (SPEC §10.2 / §18): intent lives in Postgres; whatever runs it is
// a swappable projection behind this interface. Trigger.dev Cloud is the only adapter
// today. getExecutor() returning null means "no executor configured" — callers must
// degrade to a visible "not configured" state, never throw on a render path (the same
// no-DB discipline as the renderer). No repo gate may require a live executor.

export type AutomationExecutor = {
  // Enqueue the background run for an already-persisted automation_run row. Returns
  // the executor's correlation id (Trigger.dev run_… id).
  enqueueRun(input: { runId: string }): Promise<{ executorRunId: string }>;
};

// The Trigger.dev task id the adapter enqueues (defined in src/trigger/).
export const AUTOMATION_RUN_TASK_ID = "automation-run";

// Env is read per-call, not at module load, so tests and long-lived dev servers see
// changes without a module-cache reset (the collab-secret lesson).
export function isExecutorConfigured(): boolean {
  return !!process.env.TRIGGER_SECRET_KEY;
}

export function getExecutor(): AutomationExecutor | null {
  if (!isExecutorConfigured()) return null;
  return {
    async enqueueRun({ runId }) {
      // Imported lazily so merely rendering a page that checks configuration never
      // pays for (or crashes on) the SDK in environments without it.
      const { tasks } = await import("@trigger.dev/sdk/v3");
      const handle = await tasks.trigger(AUTOMATION_RUN_TASK_ID, { runId });
      return { executorRunId: handle.id };
    },
  };
}
