import { describe, expect, it } from "vitest";
import {
  DAILY_RUN_CAP,
  enqueueAutomationRun,
  fireCodeChangeAutomations,
  fireContentUpdateAutomations,
  type AutomationRow,
  type RunStore,
} from "@/lib/automations/runs";
import type { AutomationExecutor } from "@/lib/automations/executor";

// In-memory store mirroring dbRunStore's contract (the domain-reconcile pattern:
// decision logic tested with no DB).
function memStore(
  automations: Array<Partial<AutomationRow>> = [],
  siteShas: Record<string, string | null> = {},
  orgBySite: Record<string, string> = {},
) {
  const runs: Array<Record<string, unknown>> = [];
  const store: RunStore = {
    async countBillableRunsSince(automationId, since) {
      return runs.filter(
        (r) =>
          r.automationId === automationId &&
          (r.queuedAt === undefined || (r.queuedAt as Date) >= since) &&
          (r.status !== "failed" || Number(r.creditsUsed ?? 0) > 0),
      ).length;
    },
    async lastSucceededSourceSha(automationId) {
      const hit = [...runs]
        .reverse()
        .find((r) => r.automationId === automationId && r.status === "succeeded");
      return (hit?.sourceSha as string | undefined) ?? null;
    },
    async siteSourceSha(siteId) {
      return siteShas[siteId] ?? null;
    },
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
      runs.push({ ...row, status: "queued", queuedAt: new Date() });
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
    async listCodeChangeAutomationsForRepo(repo, organizationId) {
      const repoLc = repo.toLowerCase();
      return automations.filter(
        (a) =>
          a.enabled &&
          a.triggerType === "code_change" &&
          orgBySite[a.siteId as string] === organizationId &&
          ((a.triggerRepos as string[] | undefined) ?? []).some((t) => t.toLowerCase() === repoLc),
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

// fix-broken-links reads only the docs (inputs: ["docs"]) — the skip-unchanged case.
const AUTO = { id: "auto-1", siteId: "site-1", catalogKey: "fix-broken-links" };
// draft-changelog also reads external inputs, so it must never be skipped.
const EXTERNAL_AUTO = { id: "auto-2", siteId: "site-1", catalogKey: "draft-changelog" };

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

  // --- cost guardrails (SPEC §10.2) ---

  it("caps automated runs at the daily limit but never blocks a manual one", async () => {
    const { store, runs } = memStore([], { "site-1": "sha-1" });
    const executor = okExecutor();
    const deps = { store, executor };
    // Fill the day's budget with billable runs.
    for (let i = 0; i < DAILY_RUN_CAP; i++) {
      runs.push({
        id: `r${i}`,
        automationId: EXTERNAL_AUTO.id,
        status: "succeeded",
        queuedAt: new Date(),
      });
    }
    const capped = await enqueueAutomationRun(EXTERNAL_AUTO, { triggerType: "cron" }, deps);
    expect(capped).toEqual({ ok: false, reason: "daily_cap" });
    // A human clicking Run now is neither unattended nor repeating.
    const manual = await enqueueAutomationRun(EXTERNAL_AUTO, { triggerType: "manual" }, deps);
    expect(manual.ok).toBe(true);
  });

  it("runs that failed before spending don't count toward the cap", async () => {
    const { store, runs } = memStore([], { "site-1": "sha-1" });
    const executor = okExecutor();
    for (let i = 0; i < DAILY_RUN_CAP + 5; i++) {
      runs.push({
        id: `f${i}`,
        automationId: EXTERNAL_AUTO.id,
        status: "failed",
        creditsUsed: 0,
        queuedAt: new Date(),
      });
    }
    const result = await enqueueAutomationRun(
      EXTERNAL_AUTO,
      { triggerType: "cron" },
      { store, executor },
    );
    expect(result.ok).toBe(true);
  });

  it("skips a docs-only automation when the site hasn't changed since its last success", async () => {
    const { store, runs } = memStore([], { "site-1": "sha-1" });
    const executor = okExecutor();
    const deps = { store, executor };
    const first = await enqueueAutomationRun(AUTO, { triggerType: "cron" }, deps);
    expect(first.ok).toBe(true);
    if (first.ok) await store.updateRun(first.runId, { status: "succeeded" });

    // Same sha → nothing to do, no model call, no row.
    const second = await enqueueAutomationRun(AUTO, { triggerType: "cron" }, deps);
    expect(second).toEqual({ ok: false, reason: "unchanged" });
    expect(runs).toHaveLength(1);
  });

  it("runs again once the docs move", async () => {
    const shas: Record<string, string | null> = { "site-1": "sha-1" };
    const { store, runs } = memStore([], shas);
    const executor = okExecutor();
    const deps = { store, executor };
    const first = await enqueueAutomationRun(AUTO, { triggerType: "cron" }, deps);
    if (first.ok) await store.updateRun(first.runId, { status: "succeeded" });
    shas["site-1"] = "sha-2";
    const second = await enqueueAutomationRun(AUTO, { triggerType: "cron" }, deps);
    expect(second.ok).toBe(true);
    expect(runs).toHaveLength(2);
  });

  it("never skips an automation with external inputs, or a manual run", async () => {
    const { store } = memStore([], { "site-1": "sha-1" });
    const executor = okExecutor();
    const deps = { store, executor };
    // draft-changelog reads a source repo — unchanged docs say nothing about its input.
    const ext = await enqueueAutomationRun(EXTERNAL_AUTO, { triggerType: "cron" }, deps);
    expect(ext.ok).toBe(true);
    if (ext.ok) await store.updateRun(ext.runId, { status: "succeeded" });
    const extAgain = await enqueueAutomationRun(EXTERNAL_AUTO, { triggerType: "cron" }, deps);
    expect(extAgain.ok).toBe(true);

    const first = await enqueueAutomationRun(AUTO, { triggerType: "cron" }, deps);
    if (first.ok) await store.updateRun(first.runId, { status: "succeeded" });
    const manual = await enqueueAutomationRun(AUTO, { triggerType: "manual" }, deps);
    expect(manual.ok).toBe(true);
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
  // catalogKey draft-changelog: reads external inputs, so the skip-unchanged guard
  // never applies and these stay focused on the fan-out logic itself.
  const ck = { catalogKey: "draft-changelog" };
  const site1Autos = [
    { id: "a1", siteId: "site-1", enabled: true, triggerType: "content_update", ...ck },
    { id: "a2", siteId: "site-1", enabled: true, triggerType: "content_update", ...ck },
    // Wrong trigger / disabled / wrong site — must not fire.
    { id: "a3", siteId: "site-1", enabled: true, triggerType: "cron", ...ck },
    { id: "a4", siteId: "site-1", enabled: false, triggerType: "content_update", ...ck },
    { id: "a5", siteId: "site-2", enabled: true, triggerType: "content_update", ...ck },
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
    const down = () => Promise.reject(new Error("db down"));
    const broken: RunStore = {
      findRunByTrigger: down,
      insertRun: down,
      updateRun: down,
      listEnabledAutomations: down,
      listCodeChangeAutomationsForRepo: down,
      countBillableRunsSince: down,
      lastSucceededSourceSha: down,
      siteSourceSha: down,
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

describe("fireCodeChangeAutomations", () => {
  // Two orgs; org-1 has a matching code_change automation, org-2 references the same
  // repo but is a different tenant and must NOT be triggered by org-1's push.
  const autos = [
    {
      id: "c1",
      siteId: "site-1",
      catalogKey: "update-from-code-changes",
      enabled: true,
      triggerType: "code_change",
      triggerRepos: ["acme/API"], // stored with different casing than the push
    },
    // disabled / wrong-trigger / different-repo on the same org — must not fire.
    {
      id: "c2",
      siteId: "site-1",
      catalogKey: "update-from-code-changes",
      enabled: false,
      triggerType: "code_change",
      triggerRepos: ["acme/api"],
    },
    {
      id: "c3",
      siteId: "site-1",
      catalogKey: "update-from-code-changes",
      enabled: true,
      triggerType: "code_change",
      triggerRepos: ["acme/other"],
    },
    // org-2's automation referencing the same repo.
    {
      id: "c4",
      siteId: "site-2",
      catalogKey: "update-from-code-changes",
      enabled: true,
      triggerType: "code_change",
      triggerRepos: ["acme/api"],
    },
  ];
  const orgBySite = { "site-1": "org-1", "site-2": "org-2" };
  const change = { repo: "acme/api", sha: "sha-1", changedFiles: ["src/a.ts"] };

  it("fires only the matching, enabled automation in the pushing org (case-insensitive)", async () => {
    const { store, runs } = memStore(autos, {}, orgBySite);
    const executor = okExecutor();
    await fireCodeChangeAutomations("acme/api", "org-1", change, { store, executor });
    expect(runs.map((r) => r.automationId)).toEqual(["c1"]);
    expect(runs[0].triggerType).toBe("code_change");
    expect(runs[0].triggerRef).toBe("sha-1");
    expect(runs[0].triggerContext).toEqual(change);
  });

  it("does not cross-trigger another org referencing the same repo", async () => {
    const { store, runs } = memStore(autos, {}, orgBySite);
    await fireCodeChangeAutomations("acme/api", "org-2", change, {
      store,
      executor: okExecutor(),
    });
    expect(runs.map((r) => r.automationId)).toEqual(["c4"]);
  });

  it("re-firing the same push sha is a no-op (idempotent)", async () => {
    const { store, runs } = memStore(autos, {}, orgBySite);
    const deps = { store, executor: okExecutor() };
    await fireCodeChangeAutomations("acme/api", "org-1", change, deps);
    await fireCodeChangeAutomations("acme/api", "org-1", change, deps);
    expect(runs).toHaveLength(1);
  });

  it("never throws and skips the query without an executor", async () => {
    let queried = false;
    const { store } = memStore(autos, {}, orgBySite);
    const spy: RunStore = {
      ...store,
      listCodeChangeAutomationsForRepo: async (...a) => {
        queried = true;
        return store.listCodeChangeAutomationsForRepo(...a);
      },
    };
    await fireCodeChangeAutomations("acme/api", "org-1", change, { store: spy, executor: null });
    expect(queried).toBe(false);
  });
});
