import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { AutomateHeader } from "@/components/app/automate/AutomateHeader";
import { AutomationCard, CreateCustomAutomation } from "@/components/app/automate/AutomationCard";
import type { AutomationView } from "@/components/app/automate/AutomationConfigDialog";
import { requireSite } from "@/lib/dashboard-context";
import { siteRoute } from "@/lib/dashboard-nav";
import { db } from "@/lib/db";
import { automation, automationRun } from "@/lib/db/app-schema";
import {
  AUTOMATION_CATALOG,
  CUSTOM_KEY,
  getCatalogEntry,
  type AutomationApplyMode,
  type AutomationTriggerType,
} from "@/lib/automations/catalog";
import { isExecutorConfigured } from "@/lib/automations/executor";

// Automate › Automations (SPEC §10.2) — the wired surface: Configure tab renders the
// catalog merged with this site's automation rows (toggles + settings dialogs are
// live), the Automations tab is the run history. Data flows server → serializable
// AutomationView → client cards; every mutation re-authorizes via findSite.

type AutomationRow = typeof automation.$inferSelect;

function toView(catalogKey: string, row: AutomationRow | undefined): AutomationView {
  const entry = getCatalogEntry(catalogKey);
  return {
    catalogKey,
    id: row?.id ?? null,
    title: row?.name ?? entry?.title ?? "Custom automation",
    desc: entry?.desc ?? "Define your own triggers, prompts, and actions.",
    enabled: row?.enabled ?? false,
    allowedTriggers: entry?.allowedTriggers ?? ["content_update", "cron", "code_change"],
    recommendedTrigger: entry?.recommendedTrigger ?? "content_update",
    recommended: entry?.recommended,
    triggerType:
      (row?.triggerType as AutomationTriggerType) ?? entry?.recommendedTrigger ?? "content_update",
    cronExpression: row?.cronExpression ?? null,
    triggerRepos: (row?.triggerRepos as string[] | null) ?? null,
    contextRepos: (row?.contextRepos as string[] | null) ?? null,
    applyMode: (row?.applyMode as AutomationApplyMode) ?? entry?.defaultApplyMode ?? "auto",
    additionalPrompt: row?.additionalPrompt ?? null,
    extras: (row?.extras as Record<string, unknown> | null) ?? null,
  };
}

export default async function AutomationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string; site: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { org, site } = await params;
  const { tab } = await searchParams;
  const { site: activeSite } = await requireSite(org, site);
  const siteRef = { org, site };

  const rows = await db.select().from(automation).where(eq(automation.siteId, activeSite.id));
  const byKey = new Map(
    rows.filter((r) => r.catalogKey !== CUSTOM_KEY).map((r) => [r.catalogKey, r]),
  );
  const customs = rows.filter((r) => r.catalogKey === CUSTOM_KEY);

  const selfUpdating = AUTOMATION_CATALOG.filter((e) => e.family === "self_updating");
  const maintenance = AUTOMATION_CATALOG.filter((e) => e.family === "maintenance");

  const showRuns = tab === "runs";
  const basePath = siteRoute(org, site, "automate/automations");

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-10">
      <AutomateHeader page="Automations" />

      {!isExecutorConfigured() && (
        <div className="mt-6 rounded-xl border border-amber-500/25 bg-amber-500/5 px-5 py-4 text-sm">
          <span className="font-semibold">Executor not configured.</span>{" "}
          <span className="text-[var(--muted)]">
            Automations can be set up, but runs won&apos;t start until the deployment sets{" "}
            <code className="font-mono text-xs">TRIGGER_SECRET_KEY</code>.
          </span>
        </div>
      )}

      {/* Configure / Automations (run history) tabs */}
      <div className="mt-6 inline-flex gap-1 rounded-lg border border-[rgba(var(--ink-rgb),0.06)] bg-[rgba(var(--ink-rgb),0.02)] p-1 text-sm">
        <Tab href={basePath} active={!showRuns} label="Configure" />
        <Tab href={`${basePath}?tab=runs`} active={showRuns} label="Automations" />
      </div>

      {showRuns ? (
        <RunHistory siteId={activeSite.id} />
      ) : (
        <>
          <Section
            title="Self-updating content automations"
            blurb="Keep your site self-updating as your product changes and your users evolve."
          >
            {selfUpdating.map((e) => (
              <AutomationCard key={e.key} view={toView(e.key, byKey.get(e.key))} siteRef={siteRef} />
            ))}
          </Section>

          <Section
            title="Maintenance automations"
            blurb="Have quality checks be a self-updating process across your site."
          >
            {maintenance.map((e) => (
              <AutomationCard key={e.key} view={toView(e.key, byKey.get(e.key))} siteRef={siteRef} />
            ))}
          </Section>

          <div className="mt-10">
            <h2 className="text-lg font-semibold">Custom automations</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Define your own triggers, prompts, and actions to fit your team&apos;s needs.
            </p>
            {customs.length > 0 && (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {customs.map((r) => (
                  <AutomationCard key={r.id} view={toView(CUSTOM_KEY, r)} siteRef={siteRef} />
                ))}
              </div>
            )}
            <CreateCustomAutomation siteRef={siteRef} />
          </div>
        </>
      )}
    </div>
  );
}

function Tab({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={
        active
          ? "rounded-md bg-[rgba(var(--ink-rgb),0.08)] px-3 py-1 font-medium text-[var(--fg)]"
          : "rounded-md px-3 py-1 text-[var(--muted)] hover:text-[var(--fg)]"
      }
    >
      {label}
    </Link>
  );
}

function Section({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-10">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">{blurb}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  queued: "bg-[rgba(var(--ink-rgb),0.08)] text-[var(--muted)]",
  running: "bg-sky-500/15 text-sky-300",
  succeeded: "bg-emerald-500/15 text-emerald-300",
  failed: "bg-red-500/15 text-red-300",
  canceled: "bg-[rgba(var(--ink-rgb),0.08)] text-[var(--muted)]",
};

// The run history (the reference's second tab). Newest first; resultRef renders as a
// PR link or a short commit sha.
async function RunHistory({ siteId }: { siteId: string }) {
  const runs = await db
    .select({
      id: automationRun.id,
      status: automationRun.status,
      triggerType: automationRun.triggerType,
      resultRef: automationRun.resultRef,
      summary: automationRun.summary,
      error: automationRun.error,
      creditsUsed: automationRun.creditsUsed,
      queuedAt: automationRun.queuedAt,
      finishedAt: automationRun.finishedAt,
      catalogKey: automation.catalogKey,
      name: automation.name,
    })
    .from(automationRun)
    .innerJoin(automation, eq(automationRun.automationId, automation.id))
    .where(eq(automationRun.siteId, siteId))
    .orderBy(desc(automationRun.queuedAt))
    .limit(50);

  if (runs.length === 0) {
    return (
      <div className="mt-10 rounded-xl border border-dashed border-[rgba(var(--ink-rgb),0.12)] px-6 py-12 text-center text-sm text-[var(--muted)]">
        No runs yet. Turn on an automation — every run lands here with its outcome.
      </div>
    );
  }

  return (
    <div className="mt-6 overflow-hidden rounded-xl border border-[rgba(var(--ink-rgb),0.06)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[rgba(var(--ink-rgb),0.06)] bg-[rgba(var(--ink-rgb),0.02)] text-left text-xs text-[var(--muted)]">
            <th className="px-4 py-2.5 font-medium">Automation</th>
            <th className="px-4 py-2.5 font-medium">Status</th>
            <th className="px-4 py-2.5 font-medium">Trigger</th>
            <th className="px-4 py-2.5 font-medium">Result</th>
            <th className="px-4 py-2.5 text-right font-medium">Credits</th>
            <th className="px-4 py-2.5 text-right font-medium">Queued</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[rgba(var(--ink-rgb),0.06)]">
          {runs.map((r) => {
            const title = r.name ?? getCatalogEntry(r.catalogKey)?.title ?? r.catalogKey;
            return (
              <tr key={r.id} className="align-top">
                <td className="px-4 py-3">
                  <p className="font-medium">{title}</p>
                  {(r.summary ?? r.error) && (
                    <p className="mt-1 max-w-md text-xs text-[var(--muted)]">
                      {(r.error ?? r.summary ?? "").slice(0, 160)}
                    </p>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-md px-1.5 py-0.5 text-xs font-medium ${STATUS_STYLES[r.status] ?? STATUS_STYLES.queued}`}
                  >
                    {r.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-[var(--muted)]">{r.triggerType.replace("_", " ")}</td>
                <td className="px-4 py-3">
                  {r.resultRef ? (
                    r.resultRef.startsWith("http") ? (
                      <a
                        href={r.resultRef}
                        target="_blank"
                        rel="noreferrer"
                        className="text-emerald-300 underline underline-offset-2"
                      >
                        Pull request ↗
                      </a>
                    ) : (
                      <code className="font-mono text-xs">{r.resultRef.slice(0, 7)}</code>
                    )
                  ) : (
                    <span className="text-[var(--muted)]">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{r.creditsUsed}</td>
                <td className="px-4 py-3 text-right text-xs text-[var(--muted)]">
                  {r.queuedAt.toISOString().slice(0, 16).replace("T", " ")}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
