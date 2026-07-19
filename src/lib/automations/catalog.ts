// The Automations catalog (SPEC §10.2) — the predefined automations, their trigger
// matrix, and pure config validation. This is the "presets over one shape" layer:
// every predefined automation is the same config schema as a custom one, with the
// identity/prompt/trigger-matrix baked in here. Pure module — no DB, no executor —
// so the server actions, the trigger tasks, and the unit suite all share it.

export type AutomationTriggerType = "content_update" | "cron" | "code_change";
export type AutomationApplyMode = "auto" | "review";

// The uniform config shape (SPEC §10.2 decision note). Predefined automations store
// `catalogKey`; custom ones store catalogKey 'custom' + a user-given name.
export type AutomationConfig = {
  triggerType: AutomationTriggerType;
  // cron trigger only — raw 5-field cron expression, UTC.
  cronExpression?: string | null;
  // code_change trigger only — "owner/repo" list whose merged PRs / base-branch
  // pushes fire the automation.
  triggerRepos?: string[] | null;
  // Read-only repos cloned into the run environment for context. Never trigger.
  contextRepos?: string[] | null;
  applyMode: AutomationApplyMode;
  // Extra instructions appended to the base prompt on every run.
  additionalPrompt?: string | null;
  // Per-automation extras; shape owned by the catalog entry (e.g. translate locales).
  extras?: Record<string, unknown> | null;
};

export type AutomationCatalogEntry = {
  key: string;
  title: string;
  desc: string;
  family: "self_updating" | "maintenance";
  allowedTriggers: AutomationTriggerType[];
  recommendedTrigger: AutomationTriggerType;
  // The catalog card's "Recommended" badge / default-on state.
  recommended?: boolean;
  // 'auto' commits directly through the authoring backend; 'review' opens a PR.
  // The reference recommends 'auto' everywhere; we default new configs to it too.
  defaultApplyMode: AutomationApplyMode;
  // The run's task instructions. additionalPrompt is appended verbatim after this.
  basePrompt: string;
};

// Cron presets surfaced as chips in the config UI. 13:00 UTC ≈ business-morning in
// the Americas (the reference's "9:00 AM EDT").
export const CRON_PRESETS = [
  { label: "Daily", cron: "0 13 * * *" },
  { label: "Every Monday", cron: "0 13 * * 1" },
  { label: "Every Friday", cron: "0 13 * * 5" },
  { label: "Twice weekly", cron: "0 13 * * 1,4" },
] as const;

const CONTENT_OR_CRON: AutomationTriggerType[] = ["content_update", "cron"];

export const AUTOMATION_CATALOG: AutomationCatalogEntry[] = [
  // — Self-updating content —
  {
    key: "update-from-code-changes",
    title: "Update from code changes",
    desc: "Updates content when source code for products, features, or APIs changes.",
    family: "self_updating",
    allowedTriggers: ["cron", "code_change"],
    recommendedTrigger: "cron",
    recommended: true,
    defaultApplyMode: "auto",
    basePrompt:
      "Review the recent changes in the trigger repository (merged PRs and pushes to the base branch since the last run) and update the documentation so it accurately reflects the current behavior of the code. Update API references, parameters, defaults, examples, and feature descriptions that the code changes invalidated. Do not invent features that the code does not show; do not restructure unrelated pages.",
  },
  {
    key: "draft-changelog",
    title: "Draft changelog",
    desc: "Drafts a changelog entry from recent product updates on a recurring schedule.",
    family: "self_updating",
    allowedTriggers: ["content_update", "cron", "code_change"],
    recommendedTrigger: "content_update",
    defaultApplyMode: "auto",
    basePrompt:
      "Draft a changelog entry summarizing the product changes since the last changelog entry, using the repository history and any context repositories as the source of truth. Group changes by area, lead with user-visible impact, and match the tone and format of the existing changelog pages.",
  },
  {
    key: "fill-gaps-from-assistant-conversations",
    title: "Fill gaps from assistant conversations",
    desc: "Spots what users ask your assistant most, then drafts updates to fill the gaps.",
    family: "self_updating",
    allowedTriggers: ["cron"],
    recommendedTrigger: "cron",
    defaultApplyMode: "auto",
    basePrompt:
      "Review the most frequent and most recent unanswered or poorly-answered assistant questions, identify the documentation gaps behind them, and draft new or updated pages that answer those questions directly. Prioritize by occurrence count. Keep each change focused on one gap.",
  },
  {
    key: "improve-docs-from-user-feedback",
    title: "Improve docs from user feedback",
    desc: "Turns user feedback on pages into targeted doc improvements, on a schedule.",
    family: "self_updating",
    allowedTriggers: ["cron"],
    recommendedTrigger: "cron",
    defaultApplyMode: "auto",
    basePrompt:
      "Review recent reader feedback left on documentation pages and make targeted improvements to the pages the feedback concerns. Address the specific confusion or complaint; do not rewrite pages wholesale.",
  },
  // — Maintenance —
  {
    key: "translate-content",
    title: "Translate content",
    desc: "Updates translated pages in your selected languages whenever the original content changes.",
    family: "maintenance",
    allowedTriggers: CONTENT_OR_CRON,
    recommendedTrigger: "content_update",
    defaultApplyMode: "auto",
    basePrompt:
      "Update the translated versions of any pages whose source-language content changed, in every configured target language. Preserve MDX structure, component usage, code blocks, and frontmatter exactly; translate prose and headings naturally rather than literally. Languages already configured in docs.json are always included; the automation's extras may add more.",
  },
  {
    key: "fix-broken-links",
    title: "Fix broken links",
    desc: "Finds and fixes broken internal links whenever content changes.",
    family: "maintenance",
    allowedTriggers: CONTENT_OR_CRON,
    recommendedTrigger: "content_update",
    defaultApplyMode: "auto",
    basePrompt:
      "Find internal links in the documentation that point to pages, anchors, or assets that do not exist, and fix each one to point at the correct current target. If a linked page was removed with no replacement, rewrite the sentence so it no longer needs the link. Do not change link text meaning, and do not touch working links.",
  },
  {
    key: "fix-seo-issues",
    title: "Fix SEO issues",
    desc: "Checks and fixes titles, descriptions, and tags whenever content changes.",
    family: "maintenance",
    allowedTriggers: CONTENT_OR_CRON,
    recommendedTrigger: "content_update",
    defaultApplyMode: "auto",
    basePrompt:
      "Audit page frontmatter for SEO: every page should have a concise, accurate title and a compelling meta description of appropriate length; headings should form a sensible hierarchy. Fix what is missing or wrong. Do not stuff keywords or alter the substance of the content.",
  },
  {
    key: "fix-grammar-typos",
    title: "Fix grammar & typos",
    desc: "Finds and fixes typos, spelling mistakes, and grammar errors whenever content changes.",
    family: "maintenance",
    allowedTriggers: CONTENT_OR_CRON,
    recommendedTrigger: "content_update",
    defaultApplyMode: "auto",
    basePrompt:
      "Fix typos, spelling mistakes, and grammatical errors in the documentation prose. Never change code blocks, component props, frontmatter values, URLs, or product names. Preserve the author's voice; correct only what is objectively wrong.",
  },
  {
    key: "enforce-style-guide",
    title: "Enforce your style guide",
    desc: "Keeps voice, tone, and writing rules consistent whenever content changes.",
    family: "maintenance",
    allowedTriggers: CONTENT_OR_CRON,
    recommendedTrigger: "content_update",
    defaultApplyMode: "auto",
    basePrompt:
      "Apply the project's style guide (from the additional instructions and any style pages in the repository) to recently changed documentation: voice, tone, terminology, capitalization, and formatting conventions. Make the smallest edits that bring the content into compliance.",
  },
];

// Custom automations use this sentinel catalogKey; identity (name) and the whole
// prompt live on the automation row instead of a catalog entry.
export const CUSTOM_KEY = "custom";

export const CUSTOM_ALLOWED_TRIGGERS: AutomationTriggerType[] = [
  "content_update",
  "cron",
  "code_change",
];

export function getCatalogEntry(key: string): AutomationCatalogEntry | undefined {
  return AUTOMATION_CATALOG.find((e) => e.key === key);
}

// Cheap structural cron check (5 whitespace-separated fields of cron charset), not a
// full parser — the executor's schedule registration is the authoritative validator;
// this exists to reject obvious garbage at the form boundary with a friendly error.
export function isValidCronExpression(expr: string): boolean {
  const fields = expr.trim().split(/\s+/);
  return fields.length === 5 && fields.every((f) => /^[\d*,\-/A-Za-z]+$/.test(f));
}

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

// Pure config validation shared by the server actions and the unit suite. Returns
// human-readable problems; empty array = valid.
export function validateAutomationConfig(
  catalogKey: string,
  config: AutomationConfig,
  opts: { name?: string | null } = {},
): string[] {
  const errors: string[] = [];

  let allowed: AutomationTriggerType[];
  if (catalogKey === CUSTOM_KEY) {
    allowed = CUSTOM_ALLOWED_TRIGGERS;
    if (!opts.name?.trim()) errors.push("Custom automations need a name.");
  } else {
    const entry = getCatalogEntry(catalogKey);
    if (!entry) return [`Unknown automation "${catalogKey}".`];
    allowed = entry.allowedTriggers;
  }

  if (!allowed.includes(config.triggerType)) {
    errors.push(`Trigger "${config.triggerType}" isn't available for this automation.`);
  }

  if (config.triggerType === "cron") {
    if (!config.cronExpression?.trim()) {
      errors.push("A schedule is required for the custom-schedule trigger.");
    } else if (!isValidCronExpression(config.cronExpression)) {
      errors.push("The schedule must be a 5-field cron expression.");
    }
  }

  if (config.triggerType === "code_change") {
    if (!config.triggerRepos?.length) {
      errors.push("At least one trigger repository is required for the code-change trigger.");
    }
  }

  for (const repo of [...(config.triggerRepos ?? []), ...(config.contextRepos ?? [])]) {
    if (!REPO_RE.test(repo)) errors.push(`"${repo}" isn't an owner/repo reference.`);
  }

  if (config.applyMode !== "auto" && config.applyMode !== "review") {
    errors.push(`Unknown apply mode "${config.applyMode}".`);
  }

  return errors;
}
