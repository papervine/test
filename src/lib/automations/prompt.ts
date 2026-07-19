// Run-prompt assembly (SPEC §10.2): the pure step that turns an automation's config
// into the instructions its agent run receives. Kept separate from the catalog so the
// executor task, the run-now action, and the unit suite share one implementation.
import { CUSTOM_KEY, getCatalogEntry } from "./catalog";

export type PromptInput = {
  catalogKey: string;
  // Custom automations only — shown to the agent as its job title.
  name?: string | null;
  // Appended to the base prompt every run (custom: this IS the whole task).
  additionalPrompt?: string | null;
  // Catalog-owned extras; currently only translate's target locales render.
  extras?: Record<string, unknown> | null;
  // What fired the run, e.g. "content_update @ 3f2c1a9" or "manual by <user>".
  triggerContext?: string | null;
};

// Returns the task instructions for a run, or null when the automation has no
// effective prompt (a custom automation with an empty additionalPrompt) — callers
// treat null as a config error, not an empty run.
export function buildRunPrompt(input: PromptInput): string | null {
  const parts: string[] = [];

  if (input.catalogKey === CUSTOM_KEY) {
    const body = input.additionalPrompt?.trim();
    if (!body) return null;
    if (input.name?.trim()) parts.push(`Custom automation: ${input.name.trim()}.`);
    parts.push(body);
  } else {
    const entry = getCatalogEntry(input.catalogKey);
    if (!entry) return null;
    parts.push(entry.basePrompt);

    const locales = extractLocales(input.extras);
    if (input.catalogKey === "translate-content" && locales.length) {
      parts.push(`Additional target languages for this run: ${locales.join(", ")}.`);
    }

    const extra = input.additionalPrompt?.trim();
    if (extra) parts.push(`Additional instructions from the site owner:\n${extra}`);
  }

  if (input.triggerContext?.trim()) {
    parts.push(`This run was triggered by: ${input.triggerContext.trim()}.`);
  }

  return parts.join("\n\n");
}

function extractLocales(extras: PromptInput["extras"]): string[] {
  const v = extras?.["targetLocales"];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x) : [];
}
