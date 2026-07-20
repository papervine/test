import { describe, expect, it } from "vitest";
import {
  enqueueAutomationRun,
  fireContentUpdateAutomations,
  type AutomationRow,
  type RunStore,
} from "@/lib/automations/runs";
import type { AutomationExecutor } from "@/lib/automations/executor";

// In-memory store mirroring dbRunStore's contract (the domain-reconcile pattern:
// decision logic tested with no DB).
function memStore(automations: Array<Partial<AutomationRow>> = []) {
  const runs: Array<Record<string, unknown>> = [];
  const store: RunStore = {
    async findRunByTrigger(automationId, triggerType, triggerRef) {
      const hit = runs.find(
        (r) =>
          r.automationId === automationId &&
          r.triggerType === triggerType &&
          r.triggerRef === triggerRef,
      );
      return hit ? { id: hit.id as string } : null;
    },
    async insertRun(row) {
      runs.push({ ...row, status: "queued" });
    },
    async updateRun(id, patch) {
      const row = runs.find((r) => r.id === id);
      if (row) Object.assign(row, patch);
    },
    async listEnabledAutomations(siteId, triggerType) {
      return automations.filter(
        (a) => a.siteId === siteId && a.enabled && a.triggerType === triggerType,
      ) as AutomationRow[];
    },
  };
  return { store, runs };
}

const okExecutor = (): Pick<AutomationExecutor, "enqueueRun"> & { enqueued: string[] } => {
  const enqueued: string[] = [];
  return {
    enqueued,
    async enqueueRun({ runId }) {
      enqueued.push(runId);
      return { executorRunId: `run_${runId.slice(0, 8)}` };
    },
  };
};

const failingExecutor: Pick<AutomationExecutor, "enqueueRun"> = {
  async enqueueRun() {
    throw new Error("cloud says no");
  },
};

const AUTO = { id: "auto-1", siteId: "site-1" };

describe("enqueueAutomationRun", () => {
  it("creates a queued run and records the executor correlation id", async () => {
    const { store, runs } = memStore();
    const executor = okExecutor();
    const result = await enqueueAutomationRun(
      AUTO,
      { triggerType: "manual", triggerRef: "user-1" },
      { store, executor },
    );
    expect(result.ok).toBe(true);
    expect(runs).toHaveLength(1);
    expect(runs[0].executorRunId).toMatch(/^run_/);
    expect(executor.enqueued).toHaveLength(1);
  });

  it("persists nothing when no executor is configured", async () => {
    const { store, runs } = memStore();
    const result = await enqueueAutomationRun(
      AUTO,
      { triggerType: "manual" },
      { store, executor: null },
    );
    expect(result).toEqual({ ok: false, reason: "executor_unconfigured" });
    expect(runs).toHaveLength(0);
  });

  it("dedupes on (automation, trigger, ref) — webhook redelivery enqueues once", async () => {
    const { store, runs } = memStore();
    const executor = okExecutor();
    const deps = { store, executor };
    const first = await enqueueAutomationRun(
      AUTO,
      { triggerType: "content_update", triggerRef: "sha-abc" },
      deps,
    );
    const second = await enqueueAutomationRun(
      AUTO,
      { triggerType: "content_update", triggerRef: "sha-abc" },
      deps,
    );
    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, reason: "duplicate" });
    expect(runs).toHaveLength(1);
  });

  it("keeps a visible failed run when the executor rejects the enqueue", async () => {
    const { store, runs } = memStore();
    const result = await enqueueAutomationRun(
      AUTO,
      { triggerType: "manual" },
      { store, executor: failingExecutor },
    );
    expect(result).toMatchObject({ ok: false, reason: "enqueue_failed" });
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("failed");
    expect(runs[0].error).toContain("cloud says no");
    expect(runs[0].finishedAt).toBeInstanceOf(Date);
  });
});

describe("fireContentUpdateAutomations", () => {
  const site1Autos = [
    { id: "a1", siteId: "site-1", enabled: true, triggerType: "content_update" },
    { id: "a2", siteId: "site-1", enabled: true, triggerType: "content_update" },
    // Wrong trigger / disabled / wrong site — must not fire.
    { id: "a3", siteId: "site-1", enabled: true, triggerType: "cron" },
    { id: "a4", siteId: "site-1", enabled: false, triggerType: "content_update" },
    { id: "a5", siteId: "site-2", enabled: true, triggerType: "content_update" },
  ];

  it("enqueues one run per enabled content_update automation on the site", async () => {
    const { store, runs } = memStore(site1Autos);
    const executor = okExecutor();
    await fireContentUpdateAutomations("site-1", "sha-xyz", { store, executor });
    expect(runs.map((r) => r.automationId).sort()).toEqual(["a1", "a2"]);
    expect(runs.every((r) => r.triggerRef === "sha-xyz")).toBe(true);
  });

  it("re-firing the same commit sha is a no-op (self-trigger loop breaker)", async () => {
    const { store, runs } = memStore(site1Autos);
    const executor = okExecutor();
    const deps = { store, executor };
    await fireContentUpdateAutomations("site-1", "sha-xyz", deps);
    await fireContentUpdateAutomations("site-1", "sha-xyz", deps);
    expect(runs).toHaveLength(2);
  });

  it("a null commit sha still fires, without deduping future real commits", async () => {
    const { store, runs } = memStore(site1Autos);
    const executor = okExecutor();
    const deps = { store, executor };
    await fireContentUpdateAutomations("site-1", null, deps);
    await fireContentUpdateAutomations("site-1", "sha-real", deps);
    expect(runs).toHaveLength(4);
  });

  it("never throws — a broken store cannot fail a sync", async () => {
    const broken: RunStore = {
      findRunByTrigger: () => Promise.reject(new Error("db down")),
      insertRun: () => Promise.reject(new Error("db down")),
      updateRun: () => Promise.reject(new Error("db down")),
      listEnabledAutomations: () => Promise.reject(new Error("db down")),
    };
    await expect(
      fireContentUpdateAutomations("site-1", "sha", { store: broken, executor: okExecutor() }),
    ).resolves.toBeUndefined();
  });

  it("skips even the query when no executor is configured", async () => {
    let queried = false;
    const { store } = memStore(site1Autos);
    const spyStore: RunStore = {
      ...store,
      listEnabledAutomations: async (...args) => {
        queried = true;
        return store.listEnabledAutomations(...args);
      },
    };
    await fireContentUpdateAutomations("site-1", "sha", { store: spyStore, executor: null });
    expect(queried).toBe(false);
  });
});
