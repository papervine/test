import { Plus } from "lucide-react";
import { AutomateHeader } from "@/components/app/automate/AutomateHeader";
import {
  AVAILABLE_INTEGRATIONS,
  SlackLogo,
} from "@/components/app/automate/integrations";

// Automate › Agent (SPEC §10.2). The agent is Slack-centric: connect a workspace,
// then enable connectors that feed it context. Steady state shares the §9.2 authoring
// backend — this surface is presentational scaffold (nothing posts yet): a Slack-connect
// banner, the (empty) enabled list, and the catalog of connectors available to the team.
export default function AgentPage() {
  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6">
      <AutomateHeader page="Agent" />

      {/* Settings heading + Slack workspace connect banner */}
      <div className="mt-8 flex flex-col gap-6 lg:flex-row lg:items-stretch lg:justify-between">
        <div className="shrink-0">
          <h1 className="text-xl font-semibold">Agent settings</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">Manage your agent settings</p>
        </div>

        <div className="flex items-center justify-between gap-4 rounded-2xl border border-[rgba(var(--ink-rgb),0.08)] bg-[rgba(var(--ink-rgb),0.03)] px-5 py-4 lg:max-w-2xl lg:flex-1">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <SlackLogo className="h-5 w-5" />
              <span className="font-semibold">Connect your Slack workspace</span>
              <span className="inline-flex items-center gap-1 rounded-md bg-amber-400/10 px-2 py-0.5 text-xs font-medium text-amber-400">
                <span aria-hidden>&bull;</span> Not connected
              </span>
            </div>
            <p className="mt-1.5 text-sm text-[var(--muted)]">
              Connect your Slack workspace to use the agent.
            </p>
          </div>
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-black hover:bg-white/90"
          >
            <SlackLogo className="h-4 w-4" />
            Install Slack app
          </button>
        </div>
      </div>

      <hr className="mt-8 border-[rgba(var(--ink-rgb),0.08)]" />

      {/* Enabled integrations — empty until a connector is wired up */}
      <section className="mt-8">
        <h2 className="text-base font-semibold">Enabled integrations</h2>
        <div className="mt-5 flex items-center justify-center rounded-2xl border border-[rgba(var(--ink-rgb),0.08)] bg-[rgba(var(--ink-rgb),0.02)] px-6 py-14 text-sm text-[var(--muted)]">
          No integrations enabled yet.
        </div>
      </section>

      <hr className="mt-8 border-[rgba(var(--ink-rgb),0.08)]" />

      {/* Catalog of connectors available to the team */}
      <section className="mt-8">
        <h2 className="text-base font-semibold">Available to your team</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {AVAILABLE_INTEGRATIONS.map(({ id, name, category, description, Logo }) => (
            <div
              key={id}
              className="flex items-center justify-between gap-4 rounded-2xl border border-[rgba(var(--ink-rgb),0.08)] bg-[rgba(var(--ink-rgb),0.02)] px-4 py-4"
            >
              <div className="flex min-w-0 items-center gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[rgba(var(--ink-rgb),0.08)] bg-[rgba(var(--ink-rgb),0.02)]">
                  <Logo className="h-6 w-6" />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{name}</span>
                    <span className="rounded bg-[rgba(var(--ink-rgb),0.06)] px-1.5 py-0.5 text-xs text-[var(--muted)]">
                      {category}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-sm text-[var(--muted)]">
                    {description}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-[rgba(var(--ink-rgb),0.1)] bg-[rgba(var(--ink-rgb),0.02)] px-4 py-2 text-sm font-medium hover:bg-[rgba(var(--ink-rgb),0.05)]"
              >
                <Plus className="h-4 w-4" />
                Connect
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
