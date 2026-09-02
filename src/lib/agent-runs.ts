import "server-only";
import { randomUUID } from "node:crypto";
import { and, count, desc, eq, gte } from "drizzle-orm";
import { db } from "./db";
import { agentRun, site as siteTable, slackWorkspace } from "./db/app-schema";
import { getExecutor, type AutomationExecutor } from "./automations/executor";
import { stripBotMention } from "./slack-events";

/**
 * The interactive agent's run service (SPEC §10.2 Agent) — the sibling of
 * `automations/runs.ts`, same discipline: the decision logic is pure over an injectable
 * store, so it unit-tests with no DB and no executor.
 *
 * Why a run row at all for a chat message: Slack retries any delivery it doesn't get a
 * 2xx for, and our route acks *before* the agent runs — so without a persisted
 * idempotency record a slow ack would answer (and bill) twice. The row is also the run
 * history the dashboard will show, exactly as `automation_run` is for automations.
 */

export type AgentRunRow = typeof agentRun.$inferSelect;

/** Where a Slack mention lands: which org, and which site's docs the agent reads. */
export type AgentTarget = {
  organizationId: string;
  siteId: string;
  botUserId: string;
};

export type AgentRunStore = {
  /** The workspace's org + the site the agent answers for, or null if not installed. */
  resolveTarget(teamId: string): Promise<AgentTarget | null>;
  /** Idempotency: has this Slack delivery already been accepted? */
  findRunByEventId(slackEventId: string): Promise<{ id: string } | null>;
  /** Agent turns this org has started in the window — the runaway guard. */
  countRunsSince(organizationId: string, since: Date): Promise<number>;
  insertRun(row: {
    id: string;
    organizationId: string;
    siteId: string;
    slackEventId: string;
    slackTeamId: string;
    slackChannelId: string;
    slackThreadTs: string;
    slackUserId: string;
    prompt: string;
  }): Promise<void>;
  updateRun(
    id: string,
    patch: Partial<
      Pick<
        AgentRunRow,
        | "status"
        | "executorRunId"
        | "slackMessageTs"
        | "answer"
        | "error"
        | "creditsUsed"
        | "startedAt"
        | "finishedAt"
      >
    >,
  ): Promise<void>;
};

export function dbAgentRunStore(): AgentRunStore {
  return {
    async resolveTarget(teamId) {
      const [ws] = await db
        .select()
        .from(slackWorkspace)
        .where(eq(slackWorkspace.teamId, teamId))
        .limit(1);
      if (!ws) return null;
      // v1: the org's oldest site is the one the agent answers for. A channel↔site
      // mapping is the natural next step (noted in SPEC §10.2) — until then a
      // single-site org (the common case) needs no configuration at all.
      const [site] = await db
        .select({ id: siteTable.id })
        .from(siteTable)
        .where(eq(siteTable.organizationId, ws.organizationId))
        .orderBy(siteTable.createdAt)
        .limit(1);
      if (!site) return null;
      return { organizationId: ws.organizationId, siteId: site.id, botUserId: ws.botUserId };
    },
    async findRunByEventId(slackEventId) {
      const [row] = await db
        .select({ id: agentRun.id })
        .from(agentRun)
        .where(eq(agentRun.slackEventId, slackEventId))
        .limit(1);
      return row ?? null;
    },
    async countRunsSince(organizationId, since) {
      const [row] = await db
        .select({ n: count() })
        .from(agentRun)
        .where(and(eq(agentRun.organizationId, organizationId), gte(agentRun.queuedAt, since)));
      return Number(row?.n ?? 0);
    },
    async insertRun(row) {
      await db.insert(agentRun).values(row);
    },
    async updateRun(id, patch) {
      await db.update(agentRun).set(patch).where(eq(agentRun.id, id));
    },
  };
}

/**
 * Agent turns per org per day. Unlike automations this is a *human*-driven surface, so
 * the cap exists to bound a pathological loop (a bot chain, a mention storm), not
 * unattended spend — hence generous. Overridable per deployment.
 */
export const AGENT_DAILY_RUN_CAP = Number(process.env.AGENT_DAILY_RUN_CAP ?? 500);

export type AgentEnqueueResult =
  | { ok: true; runId: string }
  | {
      ok: false;
      reason:
        | "not_installed"
        | "duplicate"
        | "executor_unconfigured"
        | "empty_prompt"
        | "daily_cap"
        | "enqueue_failed";
      error?: string;
    };

export type AgentEnqueueDeps = {
  store: AgentRunStore;
  executor: Pick<AutomationExecutor, "enqueueAgentRun"> | null;
};

/**
 * Accept one Slack mention: resolve it to an org+site, dedupe it, persist it, enqueue it.
 *
 * Ordering matters. Dedupe comes before the cap so a retry of an already-capped delivery
 * still reads as `duplicate` (not a second cap rejection), and nothing is persisted when
 * no executor is configured — no zombie queued rows the user would see as a hung agent.
 * If the executor rejects, the row is KEPT and marked failed so the failure is visible.
 */
export async function enqueueAgentRun(
  delivery: {
    teamId: string;
    eventId: string;
    channel: string;
    threadTs: string;
    userId: string;
    /** The raw message text; the bot's own @mention is stripped here, once the
     * workspace row (which knows the bot's user id) has been resolved. */
    text: string;
  },
  deps: AgentEnqueueDeps = { store: dbAgentRunStore(), executor: getExecutor() },
): Promise<AgentEnqueueResult> {
  const target = await deps.store.resolveTarget(delivery.teamId);
  if (!target) return { ok: false, reason: "not_installed" };

  const existing = await deps.store.findRunByEventId(delivery.eventId);
  if (existing) return { ok: false, reason: "duplicate" };

  if (!deps.executor) return { ok: false, reason: "executor_unconfigured" };

  // "<@U0BOT> why is login 404ing" → "why is login 404ing". A bare mention with no
  // question is nothing to run.
  const prompt = stripBotMention(delivery.text, target.botUserId);
  if (!prompt) return { ok: false, reason: "empty_prompt" };

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  if ((await deps.store.countRunsSince(target.organizationId, since)) >= AGENT_DAILY_RUN_CAP) {
    return { ok: false, reason: "daily_cap" };
  }

  const runId = randomUUID();
  await deps.store.insertRun({
    id: runId,
    organizationId: target.organizationId,
    siteId: target.siteId,
    slackEventId: delivery.eventId,
    slackTeamId: delivery.teamId,
    slackChannelId: delivery.channel,
    slackThreadTs: delivery.threadTs,
    slackUserId: delivery.userId,
    prompt,
  });

  try {
    const { executorRunId } = await deps.executor.enqueueAgentRun({ runId });
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

/** Recent agent turns for a site — the dashboard's run history (newest first). */
export async function listAgentRuns(siteId: string, limit = 20): Promise<AgentRunRow[]> {
  return db
    .select()
    .from(agentRun)
    .where(eq(agentRun.siteId, siteId))
    .orderBy(desc(agentRun.queuedAt))
    .limit(limit);
}
