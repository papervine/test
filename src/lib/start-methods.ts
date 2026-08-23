import { PenLine, GitBranch, type LucideIcon } from "lucide-react";

/**
 * The ways to start a new site (SPEC §10.11) — the catalog behind the add-site chooser at
 * /:org/connect. Pure data + two pure selectors, so the copy and the default are
 * unit-tested and the chooser component stays presentation.
 */

export type StartMethod = "scratch" | "git";

export type StartMethodOption = {
  value: StartMethod;
  title: string;
  description: string;
  icon: LucideIcon;
  /** The primary button's label, and its pending variant. */
  submit: string;
  submitPending: string;
};

export const START_METHODS: readonly StartMethodOption[] = [
  {
    value: "scratch",
    title: "Start from scratch",
    description:
      "Papervine hosts your content. Write in Studio and publish — no Git repo needed.",
    icon: PenLine,
    submit: "Create site",
    submitPending: "Creating site…",
  },
  {
    value: "git",
    title: "Connect a GitHub repo",
    description:
      "Publish MDX and a docs.json from a repo you already have. Pushes deploy automatically.",
    icon: GitBranch,
    // Unchanged from the old single-purpose form — it's what the e2e selects on, and it's
    // still the right verb.
    submit: "Connect repository",
    submitPending: "Connecting…",
  },
];

/**
 * Which method to preselect. "Start from scratch" is the fastest path to a live site, so
 * it leads — except for someone who can't open Studio (it's gated to owners/admins), who
 * would be creating a site they couldn't edit. They get the Git option selected instead.
 */
export function defaultStartMethod(viewer: { canUseStudio: boolean }): StartMethod {
  return viewer.canUseStudio ? "scratch" : "git";
}

/** The option for a value. Total over StartMethod, so callers need no fallback. */
export function startMethod(value: StartMethod): StartMethodOption {
  // Non-null: START_METHODS covers every StartMethod, asserted by a unit test.
  return START_METHODS.find((m) => m.value === value)!;
}

/** The primary button's label for the selected method. */
export function submitLabel(value: StartMethod, pending: boolean): string {
  const method = startMethod(value);
  return pending ? method.submitPending : method.submit;
}
