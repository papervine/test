import Link from "next/link";
import { ArrowRight, ArrowUp, Clock3, Code2, MessageSquare, Workflow } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { UnlockDecision, UnlockableSurface } from "@/lib/billing/unlock";

/**
 * What a plan-gated dashboard surface shows when the org's plan doesn't include it
 * (SPEC §10 Billing; decision in src/lib/billing/unlock.ts). One card, four surfaces: a
 * muted sketch of the feature, what it is in one line, the plan that has it, and where to
 * read more. Rendered ONLY when `decision.locked` — the pages return early with it, so the
 * real controls (which would 403 on first use) never mount underneath.
 *
 * The sketch is decorative (aria-hidden) and drawn from the platform tokens, so it belongs to
 * the page in both themes. Server component: nothing here is interactive beyond two links.
 */

const DOCS = "https://docs.papervine.io";

const COPY: Record<
  UnlockableSurface,
  { name: string; title: (plan: string | null) => string; body: string; learnMore: string }
> = {
  automations: {
    name: "Automations",
    title: (plan) => (plan ? `Automations come with ${plan}` : "Automations aren't in your plan"),
    body:
      "Keep the docs current without doing it by hand: on a schedule, or when your content changes, an agent drafts the edits and you decide whether they publish on their own or wait for review.",
    learnMore: `${DOCS}/control-plane/automate`,
  },
  agent: {
    name: "Agent",
    title: (plan) => (plan ? `The Agent comes with ${plan}` : "The Agent isn't in your plan"),
    body:
      "A docs agent where your team already works. Connect Slack and ask it to check a page, fix a mistake, or write up a change — it drafts against your site, and you approve.",
    learnMore: `${DOCS}/control-plane/automate`,
  },
  assistant: {
    name: "Assistant",
    title: (plan) => (plan ? `The Assistant comes with ${plan}` : "The Assistant isn't in your plan"),
    body:
      "Readers ask a question on your site and get an answer from your own docs, with the page it came from. You see what they asked and where the docs fell short.",
    learnMore: `${DOCS}/features/ai-assistant`,
  },
  widget: {
    name: "Assistant widget",
    title: (plan) =>
      plan ? `The Assistant widget comes with ${plan}` : "The Assistant widget isn't in your plan",
    body:
      "Put the same assistant on your own website with one script tag — a floating pill on your marketing site or app, answering from this site's public docs.",
    learnMore: `${DOCS}/features/assistant-widget`,
  },
};

export function UnlockCard({
  surface,
  decision,
  upgradeHref,
}: {
  surface: UnlockableSurface;
  decision: Extract<UnlockDecision, { locked: true }>;
  upgradeHref: string;
}) {
  const copy = COPY[surface];
  const planName = decision.plan?.name ?? null;
  return (
    <div
      data-testid="unlock-card"
      className="mx-auto mt-10 max-w-lg overflow-hidden rounded-2xl border border-[rgba(var(--ink-rgb),0.08)] bg-[rgba(var(--ink-rgb),0.02)]"
    >
      <Sketch surface={surface} />
      <div className="px-8 pb-8 pt-6 text-center">
        <h2 className="text-lg font-semibold">{copy.title(planName)}</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-[var(--muted)]">
          {copy.body}
        </p>
        {decision.trialEnded && (
          <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-[var(--muted)]">
            <Clock3 className="h-3.5 w-3.5" />
            Your trial included this; it has ended.
          </p>
        )}
        <div className="mt-6 flex flex-col items-center gap-3">
          <Link
            href={upgradeHref}
            className={cn(buttonVariants({ size: "lg" }), "db-cta w-full max-w-xs text-white")}
          >
            {planName ? `See ${planName} on the billing page` : "See plans"}
          </Link>
          <a
            href={copy.learnMore}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
          >
            How {copy.name === "Agent" || copy.name === "Assistant" ? `the ${copy.name}` : copy.name}{" "}
            works
            <ArrowRight className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
}

// ---- sketches: muted, token-drawn stand-ins for the surface that would be here ------------

function Bar({ w, className = "" }: { w: string; className?: string }) {
  return (
    <div
      className={cn("h-3 rounded-full bg-[rgba(var(--ink-rgb),0.08)]", className)}
      style={{ width: w }}
    />
  );
}

function Sketch({ surface }: { surface: UnlockableSurface }) {
  return (
    <div
      aria-hidden
      className="m-3 rounded-xl border border-[rgba(var(--ink-rgb),0.06)] bg-[rgba(var(--ink-rgb),0.03)] px-8 py-7"
    >
      {surface === "automations" ? <AutomationsSketch /> : null}
      {surface === "agent" ? <AgentSketch /> : null}
      {surface === "assistant" ? <AssistantSketch /> : null}
      {surface === "widget" ? <WidgetSketch /> : null}
    </div>
  );
}

// A question bar between two answered lines.
function AssistantSketch() {
  return (
    <div className="flex flex-col items-center gap-3">
      <Bar w="70%" />
      <Bar w="55%" />
      <div className="my-1 flex w-4/5 items-center justify-between rounded-full bg-[rgba(var(--ink-rgb),0.06)] py-2.5 pl-5 pr-2 text-sm text-[var(--muted)]">
        Ask about these docs…
        <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--blue)] text-white">
          <ArrowUp className="h-3.5 w-3.5" />
        </span>
      </div>
      <Bar w="55%" />
      <Bar w="70%" />
    </div>
  );
}

// The same bar, sitting in the corner of somebody else's page.
function WidgetSketch() {
  return (
    <div className="relative mx-auto h-36 w-full max-w-xs rounded-lg border border-[rgba(var(--ink-rgb),0.08)] p-3">
      <Bar w="40%" className="h-2" />
      <Bar w="85%" className="mt-3 h-2" />
      <Bar w="75%" className="mt-2 h-2" />
      <Bar w="60%" className="mt-2 h-2" />
      <div className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-[var(--blue)] px-3 py-1.5 text-xs font-medium text-white shadow-lg">
        <MessageSquare className="h-3.5 w-3.5" />
        Ask
      </div>
    </div>
  );
}

// A trigger, a schedule, and the rows they produce.
function AutomationsSketch() {
  return (
    <div className="flex flex-col items-center">
      <div className="inline-flex items-center gap-2 rounded-full bg-[rgba(var(--ink-rgb),0.06)] py-1.5 pl-3 pr-4">
        <Code2 className="h-3.5 w-3.5 text-[var(--blue)]" />
        <span className="h-3 w-3 rounded-full bg-[var(--blue)]" />
        <Bar w="64px" />
      </div>
      <div className="h-4 w-px bg-[rgba(var(--ink-rgb),0.12)]" />
      <div className="inline-flex items-center gap-2 rounded-full bg-[rgba(var(--ink-rgb),0.06)] py-1.5 pl-3 pr-4">
        <Workflow className="h-3.5 w-3.5 text-[var(--violet)]" />
        <span className="h-3 w-12 rounded-full bg-[var(--violet)]/70" />
        <Bar w="120px" />
      </div>
      <div className="h-4 w-px bg-[rgba(var(--ink-rgb),0.12)]" />
      <div className="w-full max-w-xs space-y-2 rounded-lg bg-[rgba(var(--ink-rgb),0.05)] p-3">
        <Bar w="60%" className="h-2.5" />
        <Bar w="90%" className="h-2.5" />
        <Bar w="75%" className="h-2.5" />
      </div>
    </div>
  );
}

// A short exchange in a chat, the agent's turn carrying a draft.
function AgentSketch() {
  return (
    <div className="mx-auto flex max-w-xs flex-col gap-3">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 h-6 w-6 shrink-0 rounded-md bg-[rgba(var(--ink-rgb),0.1)]" />
        <div className="space-y-1.5 pt-1">
          <Bar w="150px" className="h-2.5" />
          <Bar w="110px" className="h-2.5" />
        </div>
      </div>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md bg-[var(--blue)] text-white">
          <MessageSquare className="h-3.5 w-3.5" />
        </span>
        <div className="flex-1 space-y-1.5 rounded-lg bg-[rgba(var(--ink-rgb),0.05)] p-2.5">
          <Bar w="80%" className="h-2.5" />
          <Bar w="95%" className="h-2.5" />
          <div className="mt-1 inline-flex items-center rounded-md bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
            Draft ready for review
          </div>
        </div>
      </div>
    </div>
  );
}
