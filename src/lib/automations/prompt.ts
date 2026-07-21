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
  // code_change runs only: the source push that triggered this run, so the agent knows
  // which repo/files changed and can read them with its repo tools (SPEC §10.2).
  change?: { repo: string; sha: string; changedFiles: string[] } | null;
  // "owner/name" repos the agent may read this run (context repos + the trigger repo).
  // Rendered so the agent knows what's available to read_repo_file / list_repo_files.
  readableRepos?: string[] | null;
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

  if (input.change) {
    const { repo, sha, changedFiles } = input.change;
    const fileList =
      changedFiles.length > 0
        ? `The following files changed in that push — read them with read_repo_file to see the current code, then update any documentation they affect:\n${changedFiles.map((f) => `- ${f}`).join("\n")}`
        : `The list of changed files is unavailable (large push); use list_repo_files to survey the repo and read what's relevant.`;
    parts.push(`A push landed on the source repository ${repo} at commit ${sha}.\n${fileList}`);
  } else if (input.triggerContext?.trim()) {
    parts.push(`This run was triggered by: ${input.triggerContext.trim()}.`);
  }

  if (input.readableRepos?.length) {
    parts.push(
      `You can read files from these repositories with list_repo_files and read_repo_file: ${input.readableRepos.join(", ")}. These are read-only context; make your documentation changes only through write_page / edit_page / delete_page.`,
    );
  }

  return parts.join("\n\n");
}

function extractLocales(extras: PromptInput["extras"]): string[] {
  const v = extras?.["targetLocales"];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x) : [];
}
