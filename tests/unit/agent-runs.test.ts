import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  enqueueAgentRun,
  AGENT_DAILY_RUN_CAP,
  type AgentRunStore,
  type AgentTarget,
} from "../../src/lib/agent-runs";

// The accept-a-mention decision (SPEC §10.2 Agent). Same testing shape as
// automations/runs.ts: an injectable store, so the *rules* — dedupe, no-executor
// degradation, the cap, the enqueue-failure path — are covered with no DB and no
// executor. Slack retries any non-2xx and our route acks before the agent runs, so the
// dedupe rule is what stops a retry from answering (and billing) twice.

const TARGET: AgentTarget = { organizationId: "org1", siteId: "site1", botUserId: "U0BOT" };

const DELIVERY = {
  teamId: "T123",
  eventId: "Ev123",
  channel: "C123",
  threadTs: "1725278400.000100",
  userId: "U999",
  text: "<@U0BOT> why is login 404ing",
};

type Inserted = Parameters<AgentRunStore["insertRun"]>[0];

function makeStore(overrides: Partial<AgentRunStore> = {}) {
  const inserted: Inserted[] = [];
  const updates: { id: string; patch: Record<string, unknown> }[] = [];
  const store: AgentRunStore = {
    resolveTarget: vi.fn(async () => TARGET),
    findRunByEventId: vi.fn(async () => null),
    countRunsSince: vi.fn(async () => 0),
    insertRun: vi.fn(async (row) => {
      inserted.push(row);
    }),
    updateRun: vi.fn(async (id, patch) => {
      updates.push({ id, patch: patch as Record<string, unknown> });
    }),
    ...overrides,
  };
  return { store, inserted, updates };
}

const okExecutor = () => ({ enqueueAgentRun: vi.fn(async () => ({ executorRunId: "run_abc" })) });

describe("enqueueAgentRun", () => {
  let store: ReturnType<typeof makeStore>;

  beforeEach(() => {
    store = makeStore();
  });

  it("persists the run with the bot mention stripped, then enqueues it", async () => {
    const executor = okExecutor();
    const result = await enqueueAgentRun(DELIVERY, { store: store.store, executor });

    expect(result).toEqual({ ok: true, runId: expect.any(String) });
    expect(store.inserted).toHaveLength(1);
    expect(store.inserted[0]).toMatchObject({
      organizationId: "org1",
      siteId: "site1",
      slackEventId: "Ev123",
      slackTeamId: "T123",
      slackChannelId: "C123",
      slackThreadTs: "1725278400.000100",
      slackUserId: "U999",
      // The agent must see the question, not the mention markup.
      prompt: "why is login 404ing",
    });
    expect(executor.enqueueAgentRun).toHaveBeenCalledWith({
      runId: store.inserted[0].id,
    });
    // The executor's handle is recorded for log correlation.
    expect(store.updates).toEqual([
      { id: store.inserted[0].id, patch: { executorRunId: "run_abc" } },
    ]);
  });

  it("does nothing for a workspace that isn't installed", async () => {
    const s = makeStore({ resolveTarget: vi.fn(async () => null) });
    const executor = okExecutor();
    expect(await enqueueAgentRun(DELIVERY, { store: s.store, executor })).toEqual({
      ok: false,
      reason: "not_installed",
    });
    expect(s.inserted).toHaveLength(0);
    expect(executor.enqueueAgentRun).not.toHaveBeenCalled();
  });

  it("is idempotent on the Slack event id — a retry runs nothing", async () => {
    const s = makeStore({ findRunByEventId: vi.fn(async () => ({ id: "existing" })) });
    const executor = okExecutor();
    expect(await enqueueAgentRun(DELIVERY, { store: s.store, executor })).toEqual({
      ok: false,
      reason: "duplicate",
    });
    expect(s.inserted).toHaveLength(0);
    expect(executor.enqueueAgentRun).not.toHaveBeenCalled();
  });

  it("checks dedupe BEFORE the cap, so a retry of a capped delivery still reads as duplicate", async () => {
    const s = makeStore({
      findRunByEventId: vi.fn(async () => ({ id: "existing" })),
      countRunsSince: vi.fn(async () => AGENT_DAILY_RUN_CAP),
    });
    expect(await enqueueAgentRun(DELIVERY, { store: s.store, executor: okExecutor() })).toEqual({
      ok: false,
      reason: "duplicate",
    });
  });

  it("persists nothing when no executor is configured — no zombie queued rows", async () => {
    expect(await enqueueAgentRun(DELIVERY, { store: store.store, executor: null })).toEqual({
      ok: false,
      reason: "executor_unconfigured",
    });
    expect(store.inserted).toHaveLength(0);
  });

  it("ignores a bare mention with no question", async () => {
    const executor = okExecutor();
    expect(
      await enqueueAgentRun(
        { ...DELIVERY, text: "<@U0BOT>" },
        { store: store.store, executor },
      ),
    ).toEqual({ ok: false, reason: "empty_prompt" });
    expect(store.inserted).toHaveLength(0);
    expect(executor.enqueueAgentRun).not.toHaveBeenCalled();
  });

  it("stops at the daily cap", async () => {
    const s = makeStore({ countRunsSince: vi.fn(async () => AGENT_DAILY_RUN_CAP) });
    expect(await enqueueAgentRun(DELIVERY, { store: s.store, executor: okExecutor() })).toEqual({
      ok: false,
      reason: "daily_cap",
    });
    expect(s.inserted).toHaveLength(0);
  });

  it("keeps the row and marks it failed when the executor rejects the enqueue", async () => {
    const executor = {
      enqueueAgentRun: vi.fn(async () => {
        throw new Error("executor down");
      }),
    };
    const result = await enqueueAgentRun(DELIVERY, { store: store.store, executor });
    expect(result).toEqual({ ok: false, reason: "enqueue_failed", error: "executor down" });
    // The failure is visible in run history rather than swallowed.
    expect(store.inserted).toHaveLength(1);
    expect(store.updates[0].patch).toMatchObject({
      status: "failed",
      error: "enqueue failed: executor down",
    });
  });
});
