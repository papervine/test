"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { automation, automationRun } from "@/lib/db/app-schema";
import { publishDraft, discardSession } from "@/lib/authoring-core";
import { publishResultRef } from "@/lib/publish-mode";
import { findSite } from "@/lib/dashboard-context";
import { siteRoute } from "@/lib/dashboard-nav";
import {
  CUSTOM_KEY,
  getCatalogEntry,
  validateAutomationConfig,
  type AutomationConfig,
} from "@/lib/automations/catalog";
import { getExecutor, isExecutorConfigured } from "@/lib/automations/executor";
import {
  dbSchedulePersist,
  enqueueAutomationRun,
  syncAutomationSchedule,
} from "@/lib/automations/runs";

// `warning` = the action succeeded but a best-effort follow-up (schedule sync) didn't;
// the UI toasts it without rolling anything back.
export type AutomationActionState = { ok?: boolean; error?: string; warning?: string };
export type SiteRef = { org: string; site: string };

const automationsPath = (ref: SiteRef) => siteRoute(ref.org, ref.site, "automate/automations");

// Converge the executor's cron schedule to the row's current config (SPEC §10.2:
// intent in Postgres, schedule as projection). Returns a user-facing warning when the
// executor rejected the sync — the config itself is already saved.
async function syncScheduleFor(
  siteId: string,
  key: { id?: string; catalogKey?: string },
): Promise<string | undefined> {
  const where = key.id
    ? and(eq(automation.id, key.id), eq(automation.siteId, siteId))
    : and(eq(automation.siteId, siteId), eq(automation.catalogKey, key.catalogKey!));
  const [row] = await db.select().from(automation).where(where).limit(1);
  if (!row) return undefined;
  const res = await syncAutomationSchedule(row, {
    executor: getExecutor(),
    persist: dbSchedulePersist(row.id),
  });
  return res.ok ? undefined : `Saved, but the schedule could not be updated: ${res.error}`;
}

export type SaveAutomationInput = AutomationConfig & {
  // Predefined: the catalog key (row is found/created per site). Custom: 'custom' plus
  // `id` when editing an existing one.
  catalogKey: string;
  id?: string;
  name?: string | null;
  // Present when the dialog's primary button also enables ("Turn on").
  enabled?: boolean;
};

// Upsert an automation's config (SPEC §10.2 uniform config schema). Predefined
// automations are keyed (site, catalogKey) — the partial unique index makes the
// create race-safe; customs are keyed by id.
export async function saveAutomation(
  ref: SiteRef,
  input: SaveAutomationInput,
): Promise<AutomationActionState> {
  const active = await findSite(ref.org, ref.site);
  if (!active) return { error: "No active site." };

  const errors = validateAutomationConfig(input.catalogKey, input, { name: input.name });
  if (errors.length) return { error: errors.join(" ") };

  // Code-change triggers and context repositories both read repos via the org's GitHub
  // App installation (webhooks only fire from the App, and runs read repos with its
  // token). A PAT/public site has neither, so require the App before saving one of
  // these — otherwise the automation would fail every run (SPEC §10.2).
  const needsApp = input.triggerType === "code_change" || !!input.contextRepos?.length;
  if (needsApp && active.githubInstallationId == null) {
    return {
      error:
        "Connect this site with the GitHub App to use code-change triggers or context repositories.",
    };
  }

  const config = {
    triggerType: input.triggerType,
    cronExpression: input.triggerType === "cron" ? (input.cronExpression ?? null) : null,
    triggerRepos: input.triggerType === "code_change" ? (input.triggerRepos ?? null) : null,
    contextRepos: input.contextRepos?.length ? input.contextRepos : null,
    applyMode: input.applyMode,
    additionalPrompt: input.additionalPrompt?.trim() || null,
    extras: input.extras ?? null,
    ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
    updatedAt: new Date(),
  };

  let syncKey: { id?: string; catalogKey?: string };
  if (input.catalogKey === CUSTOM_KEY) {
    if (input.id) {
      const [existing] = await db
        .select({ id: automation.id })
        .from(automation)
        .where(and(eq(automation.id, input.id), eq(automation.siteId, active.id)))
        .limit(1);
      if (!existing) return { error: "Automation not found." };
      await db
        .update(automation)
        .set({ ...config, name: input.name?.trim() || null })
        .where(eq(automation.id, input.id));
      syncKey = { id: input.id };
    } else {
      const id = randomUUID();
      await db.insert(automation).values({
        id,
        siteId: active.id,
        catalogKey: CUSTOM_KEY,
        name: input.name?.trim() || null,
        enabled: input.enabled ?? false,
        ...config,
      });
      syncKey = { id };
    }
  } else {
    await db
      .insert(automation)
      .values({
        id: randomUUID(),
        siteId: active.id,
        catalogKey: input.catalogKey,
        enabled: input.enabled ?? false,
        ...config,
      })
      .onConflictDoUpdate({
        target: [automation.siteId, automation.catalogKey],
        targetWhere: sqlNotCustom(),
        set: config,
      });
    syncKey = { catalogKey: input.catalogKey };
  }

  const warning = await syncScheduleFor(active.id, syncKey);
  revalidatePath(automationsPath(ref));
  return { ok: true, warning };
}

// Flip an automation on/off from the card switch. Toggling a predefined automation on
// before it was ever configured creates it with the catalog's recommended defaults —
// the reference's "toggle just works; gear refines" behavior.
export async function setAutomationEnabled(
  ref: SiteRef,
  key: { catalogKey: string; id?: string },
  enabled: boolean,
): Promise<AutomationActionState> {
  const active = await findSite(ref.org, ref.site);
  if (!active) return { error: "No active site." };

  if (key.id) {
    await db
      .update(automation)
      .set({ enabled, updatedAt: new Date() })
      .where(and(eq(automation.id, key.id), eq(automation.siteId, active.id)));
  } else {
    const entry = getCatalogEntry(key.catalogKey);
    if (!entry) return { error: "Unknown automation." };
    await db
      .insert(automation)
      .values({
        id: randomUUID(),
        siteId: active.id,
        catalogKey: entry.key,
        enabled,
        triggerType: entry.recommendedTrigger,
        // The cron-recommended presets still need a schedule; default to the Monday
        // preset so an eager toggle-on is runnable, the dialog refines it.
        cronExpression: entry.recommendedTrigger === "cron" ? "0 13 * * 1" : null,
        applyMode: entry.defaultApplyMode,
      })
      .onConflictDoUpdate({
        target: [automation.siteId, automation.catalogKey],
        targetWhere: sqlNotCustom(),
        set: { enabled, updatedAt: new Date() },
      });
  }

  const warning = await syncScheduleFor(
    active.id,
    key.id ? { id: key.id } : { catalogKey: key.catalogKey },
  );
  revalidatePath(automationsPath(ref));
  return { ok: true, warning };
}

// Custom automations can be removed outright; predefined ones only disable.
export async function deleteAutomation(ref: SiteRef, id: string): Promise<AutomationActionState> {
  const active = await findSite(ref.org, ref.site);
  if (!active) return { error: "No active site." };
  // Deregister any schedule BEFORE the row goes away (the row holds the handle). A
  // failure here is survivable: the automation-cron task self-cleans stale schedules.
  const [row] = await db
    .select()
    .from(automation)
    .where(and(eq(automation.id, id), eq(automation.siteId, active.id)))
    .limit(1);
  let warning: string | undefined;
  if (row?.executorScheduleId) {
    const res = await syncAutomationSchedule(
      { ...row, enabled: false },
      { executor: getExecutor(), persist: async () => undefined },
    );
    if (!res.ok) warning = `Deleted, but the schedule could not be removed: ${res.error}`;
  }
  await db
    .delete(automation)
    .where(
      and(
        eq(automation.id, id),
        eq(automation.siteId, active.id),
        eq(automation.catalogKey, CUSTOM_KEY),
      ),
    );
  revalidatePath(automationsPath(ref));
  return { ok: true, warning };
}

// The manual "run now" trigger (SPEC §10.2) — also how an automation is tested.
// triggerRef stays null: manual runs never dedupe against each other.
export async function runAutomationNow(ref: SiteRef, id: string): Promise<AutomationActionState> {
  const active = await findSite(ref.org, ref.site);
  if (!active) return { error: "No active site." };
  if (!isExecutorConfigured()) {
    return { error: "The automations executor is not configured on this deployment." };
  }

  const [row] = await db
    .select()
    .from(automation)
    .where(and(eq(automation.id, id), eq(automation.siteId, active.id)))
    .limit(1);
  if (!row) return { error: "Automation not found." };
  if (!row.enabled) return { error: "Turn the automation on before running it." };

  const result = await enqueueAutomationRun(row, { triggerType: "manual" });
  if (!result.ok) {
    return {
      error:
        result.reason === "daily_cap"
          ? "This automation hit its daily run limit. It will resume tomorrow."
          : result.reason === "enqueue_failed"
          ? `Could not queue the run: ${result.error}`
          : "Could not queue the run.",
    };
  }
  revalidatePath(automationsPath(ref));
  return { ok: true };
}

// A run in `review_needed` left its draft on an open session branch (SPEC §10.2 in-app
// review). Load it, scoped to the site, and confirm it's still awaiting review.
async function loadReviewRun(siteId: string, runId: string) {
  const [row] = await db
    .select()
    .from(automationRun)
    .where(and(eq(automationRun.id, runId), eq(automationRun.siteId, siteId)))
    .limit(1);
  if (!row) return { error: "Run not found." as const };
  if (row.status !== "review_needed" || !row.reviewBranch)
    return { error: "This run is not awaiting review." as const };
  return { row };
}

// The commit message for an accepted run — mirror the run task's title derivation.
async function runTitle(automationId: string): Promise<string> {
  const [auto] = await db
    .select({ catalogKey: automation.catalogKey, name: automation.name })
    .from(automation)
    .where(eq(automation.id, automationId))
    .limit(1);
  if (!auto) return "automation";
  return auto.catalogKey === CUSTOM_KEY
    ? (auto.name ?? "Custom automation")
    : (getCatalogEntry(auto.catalogKey)?.title ?? auto.catalogKey);
}

// Accept a reviewed run: commit its buffered draft to the deploy branch through the shared
// authoring backend, then mark the run succeeded (SPEC §10.2). publishDraft's optimistic
// base-SHA check guards against the deploy branch moving under the pending review.
export async function acceptRun(ref: SiteRef, runId: string): Promise<AutomationActionState> {
  const active = await findSite(ref.org, ref.site);
  if (!active) return { error: "No active site." };
  const loaded = await loadReviewRun(active.id, runId);
  if ("error" in loaded) return { error: loaded.error };

  const published = await publishDraft(active, loaded.row.reviewBranch!, {
    mode: "commit",
    message: `[automation] ${await runTitle(loaded.row.automationId)}`,
    actorUserId: null,
    // Accepting an automation's run is still the automation publishing — suppress the
    // content_update fan-out so it can't re-trigger itself (see native-publish.ts).
    origin: "automation",
  });
  if (!published.ok) {
    return {
      error: published.conflict
        ? "The deploy branch moved since this run. Reject it and run the automation again."
        : (published.error ?? "Could not apply the change."),
    };
  }
  await db
    .update(automationRun)
    .set({
      status: "succeeded",
      // A commit sha, a PR URL, or null on a Papervine-hosted site, which has neither.
      resultRef: publishResultRef(published),
      reviewBranch: null,
    })
    .where(eq(automationRun.id, runId));
  revalidatePath(automationsPath(ref));
  return { ok: true };
}

// Reject a reviewed run: discard its draft session (the change never lands) and mark the run
// rejected. discardSession closes the session; the buffered draft rows fall away with it.
export async function rejectRun(ref: SiteRef, runId: string): Promise<AutomationActionState> {
  const active = await findSite(ref.org, ref.site);
  if (!active) return { error: "No active site." };
  const loaded = await loadReviewRun(active.id, runId);
  if ("error" in loaded) return { error: loaded.error };

  await discardSession(active, loaded.row.reviewBranch!);
  await db
    .update(automationRun)
    .set({ status: "rejected", reviewBranch: null })
    .where(eq(automationRun.id, runId));
  revalidatePath(automationsPath(ref));
  return { ok: true };
}

// The partial unique index (site, catalogKey) WHERE catalog_key != 'custom' needs the
// matching predicate on conflict targets. Kept in one place.
function sqlNotCustom() {
  return sql`${automation.catalogKey} != 'custom'`;
}
