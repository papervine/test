"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { automation } from "@/lib/db/app-schema";
import { findSite } from "@/lib/dashboard-context";
import { siteRoute } from "@/lib/dashboard-nav";
import {
  CUSTOM_KEY,
  getCatalogEntry,
  validateAutomationConfig,
  type AutomationConfig,
} from "@/lib/automations/catalog";
import { isExecutorConfigured } from "@/lib/automations/executor";
import { enqueueAutomationRun } from "@/lib/automations/runs";

export type AutomationActionState = { ok?: boolean; error?: string };
export type SiteRef = { org: string; site: string };

const automationsPath = (ref: SiteRef) => siteRoute(ref.org, ref.site, "automate/automations");

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
    } else {
      await db.insert(automation).values({
        id: randomUUID(),
        siteId: active.id,
        catalogKey: CUSTOM_KEY,
        name: input.name?.trim() || null,
        enabled: input.enabled ?? false,
        ...config,
      });
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
  }

  revalidatePath(automationsPath(ref));
  return { ok: true };
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

  revalidatePath(automationsPath(ref));
  return { ok: true };
}

// Custom automations can be removed outright; predefined ones only disable.
export async function deleteAutomation(ref: SiteRef, id: string): Promise<AutomationActionState> {
  const active = await findSite(ref.org, ref.site);
  if (!active) return { error: "No active site." };
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
  return { ok: true };
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
        result.reason === "enqueue_failed"
          ? `Could not queue the run: ${result.error}`
          : "Could not queue the run.",
    };
  }
  revalidatePath(automationsPath(ref));
  return { ok: true };
}

// The partial unique index (site, catalogKey) WHERE catalog_key != 'custom' needs the
// matching predicate on conflict targets. Kept in one place.
function sqlNotCustom() {
  return sql`${automation.catalogKey} != 'custom'`;
}
