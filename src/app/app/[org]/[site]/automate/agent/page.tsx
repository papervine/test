import { AutomateHeader } from "@/components/app/automate/AutomateHeader";
import { UnlockCard } from "@/components/app/UnlockCard";
import { requireSite } from "@/lib/dashboard-context";
import { siteHref } from "@/lib/dashboard-nav";
import { getUnlock } from "@/lib/billing/store";
import { isSlackConfigured, slackInstallUrl, encodeSlackInstallState } from "@/lib/slack";
import { getSlackWorkspaceForOrg } from "@/lib/slack-workspaces";
import { listConnections, nangoConfigured } from "@/lib/integrations/nango";
import { findConnector } from "@/lib/integrations/catalog";
import { ConnectSource } from "@/components/app/automate/ConnectSource";
import { disconnectSlack, disconnectSource } from "./actions";
import {
  AVAILABLE_INTEGRATIONS,
  SlackLogo,
} from "@/components/app/automate/integrations";

// Automate › Agent (SPEC §10.2). The agent is Slack-centric: connect a workspace
// (first-party OAuth — src/lib/slack.ts), then enable connectors that feed it context.
// The Slack banner is live (install/disconnect); the connector catalog below is still
// presentational until the Nango connection store lands.
export default async function AgentPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string; site: string }>;
  searchParams: Promise<{ slack?: string }>;
}) {
  const { org, site } = await params;
  const { slack: slackFlag } = await searchParams;
  const { org: activeOrg, session } = await requireSite(org, site);
  // Plan gate — see the Automations page for the rule. The agent follows the same
  // entitlement as automations (src/lib/billing/unlock.ts explains why).
  const unlock = await getUnlock(activeOrg.id, "agent", { actorEmail: session.user.email });
  if (unlock.locked) {
    return (
      <div className="px-4 sm:px-6 lg:px-8 py-6">
        <AutomateHeader page="Agent" />
        <UnlockCard
          surface="agent"
          decision={unlock}
          upgradeHref={siteHref(org, site, "settings/billing")}
        />
      </div>
    );
  }
  const workspace = await getSlackWorkspaceForOrg(activeOrg.id);
  const configured = isSlackConfigured();

  // Split the one catalog into what's attached and what's on offer. Connections are the
  // source of truth; the gallery entry supplies the name/logo, and the connector entry
  // (when there is one) supplies what the agent can actually do with it.
  // Connections are listed regardless of configuration: a deployment that loses its
  // NANGO_SECRET_KEY still HAS the rows, and hiding them would leave an org unable to see
  // — or disconnect — a source it had already attached. Only connecting a NEW one needs
  // the backend.
  const integrationsConfigured = nangoConfigured();
  const connections = await listConnections(activeOrg.id);
  const connectedIds = new Set(
    connections.filter((c) => c.status === "active").map((c) => c.provider),
  );
  const decorated = AVAILABLE_INTEGRATIONS.map((entry) => ({
    ...entry,
    connector: findConnector(entry.id),
  }));
  const connected = decorated.filter((entry) => connectedIds.has(entry.id));
  const unconnected = decorated.filter((entry) => !connectedIds.has(entry.id));
  // Three sections, because "you can connect this" and "this doesn't exist yet" are
  // different answers and shouldn't share a heading. A card with no connector entry has
  // no tool set written, so it goes below with the rest of the roadmap rather than
  // sitting among things that work.
  const available = unconnected.filter((entry) => entry.connector);
  const comingSoon = unconnected.filter((entry) => !entry.connector);
  // The state binds the round trip to this org+site (AES-GCM, TTL'd) — the callback
  // still re-derives authorization from the session; this only picks the return page.
  const installHref = configured
    ? slackInstallUrl(encodeSlackInstallState({ org, site }))
    : null;
  const installError =
    slackFlag === "error"
      ? "Slack didn't complete the install — try again."
      : slackFlag === "state_expired"
        ? "The install link expired — try again."
        : null;

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6">
      <AutomateHeader page="Agent" />

      {/* Settings heading + Slack workspace connect banner */}
      <div className="mt-8 flex flex-col gap-6 lg:flex-row lg:items-stretch lg:justify-between">
        <div className="shrink-0">
          <h1 className="text-xl font-semibold">Agent settings</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">Manage your docs agent</p>
        </div>

        {/* Stack the actions under the copy on a phone: a row with Reinstall +
            Disconnect squeezes the title and description into a leftover column. */}
        <div
          data-testid="slack-workspace-card"
          className="flex flex-col gap-4 rounded-2xl border border-[rgba(var(--ink-rgb),0.08)] bg-[rgba(var(--ink-rgb),0.03)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between lg:max-w-2xl lg:flex-1"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <SlackLogo className="h-5 w-5 shrink-0" />
              <span className="font-semibold">
                {workspace ? "Slack workspace" : "Connect your Slack workspace"}
              </span>
              {workspace ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-400/10 px-2 py-0.5 text-xs font-medium text-emerald-400">
                  <span aria-hidden>&bull;</span> Connected
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-md bg-amber-400/10 px-2 py-0.5 text-xs font-medium text-amber-400">
                  <span aria-hidden>&bull;</span> {configured ? "Not connected" : "Not configured"}
                </span>
              )}
            </div>
            <p className="mt-1.5 text-sm text-[var(--muted)]">
              {workspace
                ? `Connected to ${workspace.teamName}. Mention @papervine in a channel to talk to the agent.`
                : configured
                  ? "Connect your Slack workspace to use the agent."
                  : "This deployment has no Slack app configured (SLACK_CLIENT_ID / SLACK_CLIENT_SECRET / SLACK_SIGNING_SECRET)."}
            </p>
            {installError ? (
              <p className="mt-1.5 text-sm text-red-400">{installError}</p>
            ) : null}
          </div>
          {workspace ? (
            <div className="flex shrink-0 items-center gap-2 self-start sm:self-auto">
              {installHref ? (
                <a
                  href={installHref}
                  className="inline-flex items-center rounded-xl border border-[rgba(var(--ink-rgb),0.1)] bg-[rgba(var(--ink-rgb),0.02)] px-4 py-2 text-sm font-medium hover:bg-[rgba(var(--ink-rgb),0.05)]"
                >
                  Reinstall
                </a>
              ) : null}
              <form action={disconnectSlack.bind(null, { org, site })}>
                <button
                  type="submit"
                  className="inline-flex items-center rounded-xl border border-[rgba(var(--ink-rgb),0.1)] bg-[rgba(var(--ink-rgb),0.02)] px-4 py-2 text-sm font-medium text-[var(--muted)] hover:bg-[rgba(var(--ink-rgb),0.05)] hover:text-red-400"
                >
                  Disconnect
                </button>
              </form>
            </div>
          ) : installHref ? (
            <a
              href={installHref}
              className="inline-flex shrink-0 self-start items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-black hover:bg-white/90 sm:self-auto"
            >
              <SlackLogo className="h-4 w-4" />
              Install Slack app
            </a>
          ) : (
            <button
              type="button"
              disabled
              className="inline-flex shrink-0 self-start cursor-not-allowed items-center gap-2 rounded-xl bg-white/40 px-4 py-2.5 text-sm font-semibold text-black/60 sm:self-auto"
            >
              <SlackLogo className="h-4 w-4" />
              Install Slack app
            </button>
          )}
        </div>
      </div>

      <hr className="mt-8 border-[rgba(var(--ink-rgb),0.08)]" />

      {/* Enabled integrations — empty until a connector is wired up */}
      <section className="mt-8">
        <h2 className="text-base font-semibold">Enabled integrations</h2>
        {connected.length === 0 ? (
          <div className="mt-5 flex items-center justify-center rounded-2xl border border-[rgba(var(--ink-rgb),0.08)] bg-[rgba(var(--ink-rgb),0.02)] px-6 py-14 text-sm text-[var(--muted)]">
            No integrations enabled yet.
          </div>
        ) : (
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {connected.map(({ id, name, description, Logo, connector }) => (
              <div
                key={id}
                className="flex flex-col gap-4 rounded-2xl border border-[rgba(var(--ink-rgb),0.08)] bg-[rgba(var(--ink-rgb),0.03)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 items-center gap-4">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[rgba(var(--ink-rgb),0.08)] bg-[rgba(var(--ink-rgb),0.02)]">
                    <Logo className="h-6 w-6" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{name}</span>
                      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-400/10 px-2 py-0.5 text-xs font-medium text-emerald-400">
                        <span aria-hidden>&bull;</span> Connected
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-sm text-[var(--muted)]">
                      {connector?.hasTools
                        ? connector.capability
                        : `${description} The agent can't read this source yet.`}
                    </p>
                  </div>
                </div>
                <form action={disconnectSource.bind(null, { org, site }, id)} className="self-start sm:self-auto">
                  <button
                    type="submit"
                    className="inline-flex shrink-0 items-center rounded-xl border border-[rgba(var(--ink-rgb),0.1)] bg-[rgba(var(--ink-rgb),0.02)] px-4 py-2 text-sm font-medium text-[var(--muted)] hover:bg-[rgba(var(--ink-rgb),0.05)] hover:text-red-400"
                  >
                    Disconnect
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}
      </section>

      <hr className="mt-8 border-[rgba(var(--ink-rgb),0.08)]" />

      {/* Catalog of connectors available to the team */}
      <section className="mt-8">
        <h2 className="text-base font-semibold">Available to your team</h2>
        {!integrationsConfigured ? (
          <p className="mt-2 text-sm text-[var(--muted)]">
            This deployment has no integrations backend configured (NANGO_SECRET_KEY), so
            sources can&rsquo;t be connected.
          </p>
        ) : null}
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {available.map(({ id, name, category, description, Logo }) => (
            <div
              key={id}
              className="flex flex-col gap-4 rounded-2xl border border-[rgba(var(--ink-rgb),0.08)] bg-[rgba(var(--ink-rgb),0.02)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
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
                  <p className="mt-0.5 truncate text-sm text-[var(--muted)]">{description}</p>
                </div>
              </div>
              {/* Everything in this section HAS a connector; the only reason its button
                  might be disabled is a missing backend, which is a deployment gap an
                  operator can fix rather than a missing feature — so it says so. */}
              <ConnectSource
                org={org}
                provider={id}
                name={name}
                disabled={!integrationsConfigured}
                disabledReason="This deployment has no integrations backend configured."
              />
            </div>
          ))}
        </div>
      </section>

      {comingSoon.length > 0 ? (
        <>
          <hr className="mt-8 border-[rgba(var(--ink-rgb),0.08)]" />

          {/* Connectors we intend to build but haven't. Their own section rather than
              greyed-out cards among the working ones: "you can connect this" and "this
              doesn't exist yet" are different answers, and mixing them makes the whole
              catalog read as broken. */}
          <section className="mt-8">
            <h2 className="text-base font-semibold">Coming soon</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Planned connectors. They&rsquo;ll move up to{" "}
              <span className="italic">Available to your team</span> as each one lands.
            </p>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {comingSoon.map(({ id, name, category, description, Logo }) => (
                <div
                  key={id}
                  className="flex flex-col gap-4 rounded-2xl border border-[rgba(var(--ink-rgb),0.06)] bg-[rgba(var(--ink-rgb),0.01)] px-4 py-4 opacity-70 sm:flex-row sm:items-center sm:justify-between"
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
                      <p className="mt-0.5 truncate text-sm text-[var(--muted)]">{description}</p>
                    </div>
                  </div>
                  <span className="inline-flex shrink-0 self-start items-center rounded-xl border border-[rgba(var(--ink-rgb),0.08)] px-4 py-2 text-sm font-medium text-[var(--muted)] sm:self-auto">
                    Coming soon
                  </span>
                </div>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
