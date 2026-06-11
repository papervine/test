import {
  Settings,
  Code2,
  ScrollText,
  MessageSquare,
  MessageSquareText,
  Globe,
  Link2,
  Search,
  SpellCheck,
  Sparkles,
  Plus,
  type LucideIcon,
} from "lucide-react";
import { AutomateHeader } from "@/components/app/automate/AutomateHeader";

// Automate › Workflows (SPEC §10.2). Scaffold only: the catalog, tabs, and toggles
// are presentational — nothing here is wired to a backend yet. The data shape below
// is deliberately the shape we'd expect a real workflow registry to expose.
type Workflow = {
  title: string;
  desc: string;
  icon: LucideIcon;
  recommended?: boolean;
};

const SELF_UPDATING: Workflow[] = [
  {
    title: "Update from code changes",
    desc: "Updates content when source code for products, features, or APIs changes.",
    icon: Code2,
    recommended: true,
  },
  {
    title: "Draft changelog",
    desc: "Drafts a changelog entry from recent product updates on a recurring schedule.",
    icon: ScrollText,
  },
  {
    title: "Draft improvements from assistant conversations",
    desc: "Reviews assistant question trends and opens targeted content updates on a schedule.",
    icon: MessageSquare,
  },
  {
    title: "Draft improvements from user feedback",
    desc: "Reviews page feedback and opens targeted updates on a schedule.",
    icon: MessageSquareText,
  },
];

const MAINTENANCE: Workflow[] = [
  {
    title: "Translate content",
    desc: "Keeps your selected languages in sync whenever content changes.",
    icon: Globe,
  },
  {
    title: "Fix broken links",
    desc: "Finds and fixes broken internal and external links whenever content changes.",
    icon: Link2,
  },
  {
    title: "Audit SEO metadata",
    desc: "Audits titles, meta descriptions, headings, and canonical tags whenever content changes.",
    icon: Search,
  },
  {
    title: "Fix grammar & typos",
    desc: "Finds and fixes typos, spelling mistakes, and grammar errors whenever content changes.",
    icon: SpellCheck,
  },
  {
    title: "Apply style guide",
    desc: "Enforces your style guide's voice, tone, and rules whenever content changes.",
    icon: Sparkles,
  },
];

export default function WorkflowsPage() {
  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <AutomateHeader page="Workflows" />

      {/* First-run banner */}
      <div className="mt-6 flex items-center justify-between gap-4 rounded-xl border border-white/[0.06] bg-white/[0.03] px-5 py-4">
        <div className="flex items-center gap-3">
          <Settings className="h-5 w-5 text-[var(--muted)]" />
          <p className="text-sm">
            <span className="font-semibold">Set up your first Workflow</span>
            <span className="ml-2 text-[var(--muted)]">
              Update from code changes is one of many Workflows
            </span>
          </p>
        </div>
        <button
          disabled
          className="shrink-0 cursor-not-allowed rounded-lg bg-white px-3.5 py-1.5 text-sm font-medium text-black/90 opacity-90"
        >
          Quick Setup
        </button>
      </div>

      {/* Workflows / Configure tabs */}
      <div className="mt-6 inline-flex gap-1 rounded-lg border border-white/[0.06] bg-white/[0.02] p-1 text-sm">
        <span className="rounded-md px-3 py-1 text-[var(--muted)]">Workflows</span>
        <span className="rounded-md bg-white/[0.08] px-3 py-1 font-medium text-[var(--fg)]">
          Configure
        </span>
      </div>

      <Section
        title="Self-updating content workflows"
        blurb="Automatically update your site based on code changes, product updates, and user signals."
        items={SELF_UPDATING}
      />

      <Section
        title="Maintenance workflows"
        blurb="Automate routine quality and consistency improvements across your site."
        items={MAINTENANCE}
      />

      <div className="mt-10">
        <h2 className="text-lg font-semibold">Custom workflows</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Define your own triggers, prompts, and actions to fit your team&apos;s needs.{" "}
          <LearnMore />
        </p>
        <button
          disabled
          className="mt-4 flex w-full cursor-not-allowed items-center gap-3 rounded-xl border border-dashed border-white/[0.12] px-5 py-4 text-left"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.06]">
            <Plus className="h-4 w-4 text-[var(--muted)]" />
          </span>
          <span>
            <span className="block text-sm font-medium">Create a custom workflow</span>
            <span className="block text-sm text-[var(--muted)]">
              Define your own triggers, prompts, and actions to fit your team&apos;s needs.
            </span>
          </span>
        </button>
      </div>
    </div>
  );
}

function Section({
  title,
  blurb,
  items,
}: {
  title: string;
  blurb: string;
  items: Workflow[];
}) {
  return (
    <div className="mt-10">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        {blurb} <LearnMore />
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {items.map((w) => (
          <WorkflowCard key={w.title} workflow={w} />
        ))}
      </div>
    </div>
  );
}

function WorkflowCard({ workflow: w }: { workflow: Workflow }) {
  const Icon = w.icon;
  return (
    <div className="flex items-center gap-4 rounded-xl border border-white/[0.06] bg-white/[0.02] px-5 py-5">
      <Icon className="h-5 w-5 shrink-0 text-[var(--muted)]" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="text-[15px] font-medium">{w.title}</h3>
          {w.recommended && (
            <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-xs font-medium text-emerald-300">
              Recommended
            </span>
          )}
        </div>
        <p className="mt-1.5 text-sm text-[var(--muted)]">{w.desc}</p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <Toggle />
        <Settings className="h-[18px] w-[18px] text-[var(--muted)]/70" />
      </div>
    </div>
  );
}

// Presentational off-state switch — scaffold UI, intentionally inert.
function Toggle() {
  return (
    <span className="inline-flex h-6 w-11 items-center rounded-full bg-white/[0.12] p-0.5">
      <span className="h-5 w-5 rounded-full bg-white/80" />
    </span>
  );
}

function LearnMore() {
  return (
    <span className="cursor-default text-[var(--fg)]/80 underline underline-offset-2">
      Learn more
    </span>
  );
}
