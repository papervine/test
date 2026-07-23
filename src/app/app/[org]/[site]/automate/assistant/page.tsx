import {
  LineChart,
  ArrowRight,
  ArrowUp,
  Mail,
  Globe,
  Plus,
  Info,
  AlertTriangle,
} from "lucide-react";
import { AutomateHeader } from "@/components/app/automate/AutomateHeader";
import { requireSite } from "@/lib/dashboard-context";
import { assistantMetrics } from "@/lib/analytics";
import {
  AssistantStatusControl,
  AssistantCaptchaToggle,
} from "./AssistantControls";

// Automate › Assistant (SPEC §8.6 / §10.2). The AI-assistant management page:
// usage overview + enable/disable, deflection, search domains, bot protection, and
// starter questions. The two *operational* toggles — Assistant Status and Invisible
// CAPTCHA — are live: they persist to the DB (instant effect, no Git commit) via the
// AssistantControls client components. The published-behavior config (deflection,
// search domains, starter questions) is docs.json-backed (§8.6) and edited through the
// authoring layer (§9.2); those controls are still scaffold. The overview numbers are real
// — computed from analytics_event (type='assistant') split by outcome status.
// Format a delta as a short percent label ("42%"), or null when there's nothing to show.
function fmtDelta(delta: { pct: number; dir: "up" | "down" | "flat" } | null): string | null {
  if (!delta || delta.pct === 0) return null;
  return `${Math.abs(delta.pct)}%`;
}

export default async function AssistantPage({
  params,
}: {
  params: Promise<{ org: string; site: string }>;
}) {
  const { org, site } = await params;
  const { site: activeSite } = await requireSite(org, site);
  // Real usage from analytics_event (type='assistant'), split by outcome status.
  const usage = await assistantMetrics(activeSite.id);
  const METRICS = [
    { label: "Total questions", value: String(usage.total), delta: fmtDelta(usage.totalDelta) },
    { label: "Answered properly", value: String(usage.answered), delta: fmtDelta(usage.answeredDelta) },
    { label: "Not Answered", value: String(usage.notAnswered), delta: null },
  ];
  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-10">
      <AutomateHeader page="Ask" />

      {/* Usage overview — links to the Analytics deep-dive (§10.1) */}
      <div className="mt-6 grid grid-cols-1 divide-y divide-[rgba(var(--ink-rgb),0.06)] overflow-hidden rounded-xl border border-[rgba(var(--ink-rgb),0.06)] sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
        {METRICS.map((m) => (
          <div key={m.label} className="bg-[rgba(var(--ink-rgb),0.02)] p-4">
            <p className="text-sm text-[var(--muted)]">{m.label}</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums">{m.value}</p>
            <p className="mt-3 text-xs">
              {m.delta ? (
                <span className="inline-flex items-center gap-0.5 text-emerald-400">
                  <ArrowUp className="h-3 w-3" />
                  {m.delta} <span className="text-[var(--muted)]">vs last month</span>
                </span>
              ) : (
                <span className="text-[var(--muted)]">—</span>
              )}
            </p>
          </div>
        ))}
        <div className="flex flex-col bg-[rgba(var(--ink-rgb),0.02)] p-4">
          <LineChart className="h-4 w-4 text-[var(--muted)]" />
          <p className="mt-2 text-sm text-[var(--muted)]">
            Get insights into your Assistant usage
          </p>
          <a
            href={`/${org}/${site}/analytics?tab=agents`}
            className="mt-3 inline-flex w-fit items-center gap-1.5 rounded-lg bg-[rgba(var(--ink-rgb),0.06)] px-3 py-1.5 text-xs font-medium hover:bg-[rgba(var(--ink-rgb),0.1)]"
          >
            View more <ArrowRight className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>

      <SettingRow
        title="Status and control"
        desc="Manage your assistant's operational status"
      >
        <Card>
          <AssistantStatusControl
            siteRef={{ org, site }}
            enabled={activeSite.assistantEnabled}
          />
        </Card>
      </SettingRow>

      <SettingRow
        title="Response handling"
        desc="Configure how your assistant handles queries and searches"
      >
        <Card>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Assistant Deflection</span>
                <span className="text-xs text-[var(--muted)]">Recommended</span>
              </div>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Enable assistant to deflect questions with no responses to your support
                team.
              </p>
            </div>
            <Toggle />
          </div>

          <div className="mt-4 flex items-center gap-2 rounded-lg border border-[rgba(var(--ink-rgb),0.08)] px-3 py-2.5">
            <Mail className="h-4 w-4 shrink-0 text-[var(--muted)]" />
            <input
              disabled
              placeholder="support@example.com"
              className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--muted)]/70"
            />
          </div>

          <label className="mt-4 flex items-start gap-2.5">
            <input type="checkbox" disabled className="mt-0.5 h-4 w-4 rounded" />
            <span>
              <span className="block text-sm font-medium">Show help button on AI chat</span>
              <span className="block text-sm text-[var(--muted)]">
                Display the &apos;Contact support&apos; button to allow users to email your
                team directly.
              </span>
            </span>
          </label>

          <button
            disabled
            className="mt-4 cursor-not-allowed text-sm font-medium text-[var(--muted)]"
          >
            Save Changes
          </button>
        </Card>

        {/* Enterprise gate — Search Domains is plan-locked */}
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-amber-500/20 bg-amber-900/20 px-4 py-3">
          <span className="flex items-center gap-2 text-sm text-amber-200/90">
            <AlertTriangle className="h-4 w-4" />
            This feature is only available for enterprise plans
          </span>
          <button
            disabled
            className="inline-flex shrink-0 cursor-not-allowed items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-black/90"
          >
            Contact Sales <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <Card className="mt-3 opacity-60">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Search Domains</span>
                <span className="text-xs text-[var(--muted)]">0</span>
              </div>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Configure domains to search when providing context to the AI assistant.
              </p>
            </div>
            <Toggle />
          </div>
          <p className="mt-4 text-sm font-medium">Add new domain</p>
          <div className="mt-2 flex items-center gap-3">
            <div className="flex flex-1 items-center gap-2 rounded-lg border border-[rgba(var(--ink-rgb),0.08)] px-3 py-2.5">
              <Globe className="h-4 w-4 shrink-0 text-[var(--muted)]" />
              <input
                disabled
                placeholder="docs.papervine.io"
                className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--muted)]/70"
              />
            </div>
            <button
              disabled
              className="inline-flex shrink-0 cursor-not-allowed items-center gap-1.5 rounded-lg border border-[rgba(var(--ink-rgb),0.08)] px-3 py-2.5 text-sm text-[var(--muted)]"
            >
              <Plus className="h-4 w-4" /> Add domain
            </button>
          </div>
        </Card>
      </SettingRow>

      <SettingRow
        title="Bot protection"
        desc="Protect your assistant from automated queries."
      >
        <Card className="flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium">Invisible Captcha</span>
              <Info className="h-3.5 w-3.5 text-[var(--muted)]" />
            </div>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Privacy-friendly and invisible to nearly all visitors. Subject to
              hCaptcha&apos;s{" "}
              <span className="cursor-default underline underline-offset-2">
                privacy policy
              </span>
              .
            </p>
          </div>
          <AssistantCaptchaToggle
            siteRef={{ org, site }}
            enabled={activeSite.assistantCaptchaEnabled}
          />
        </Card>
      </SettingRow>

      <SettingRow
        title="Starter questions"
        desc="Configure questions that appear as suggestions in the assistant chat UI."
      >
        <Card className="flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Starter Questions</span>
              <span className="text-xs text-[var(--muted)]">0/3</span>
            </div>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Suggestions currently available for chat
            </p>
          </div>
          <Toggle />
        </Card>
      </SettingRow>
    </div>
  );
}

function SettingRow({
  title,
  desc,
  children,
}: {
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-6 border-t border-[rgba(var(--ink-rgb),0.06)] py-8 md:grid-cols-3">
      <div>
        <h2 className="text-base font-medium">{title}</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">{desc}</p>
      </div>
      <div className="md:col-span-2">{children}</div>
    </div>
  );
}

function Card({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-xl border border-[rgba(var(--ink-rgb),0.06)] bg-[rgba(var(--ink-rgb),0.02)] p-5 ${className}`}
    >
      {children}
    </div>
  );
}

// Presentational switch — scaffold UI, intentionally inert. `on` is the green/active
// state, off is the neutral track.
function Toggle({ on = false }: { on?: boolean }) {
  return (
    <span
      className={`inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 ${
        on ? "justify-end bg-emerald-500" : "justify-start bg-[rgba(var(--ink-rgb),0.12)]"
      }`}
    >
      <span className="h-5 w-5 rounded-full bg-white" />
    </span>
  );
}
