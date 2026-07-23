import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { ArrowLeft, FileText } from "lucide-react";
import { AutomateHeader } from "@/components/app/automate/AutomateHeader";
import { requireSite } from "@/lib/dashboard-context";
import { siteHref } from "@/lib/dashboard-nav";
import { db } from "@/lib/db";
import { automation, automationRun, usageEvent } from "@/lib/db/app-schema";
import { CUSTOM_KEY, getCatalogEntry } from "@/lib/automations/catalog";
import { runDisplayStatus, runStatusChipClass } from "@/lib/automations/run-display";

// Run detail (SPEC §10.2, the reference's click-into-a-run view): the run's exact
// prompt (its own copy, not the current config's), full agent summary, the files it
// changed, model/token usage, and the resulting commit or PR.

const fmt = (d: Date | null) => (d ? d.toISOString().slice(0, 19).replace("T", " ") + " UTC" : "—");

export default async function AutomationRunPage({
  params,
}: {
  params: Promise<{ org: string; site: string; run: string }>;
}) {
  const { org, site, run: runId } = await params;
  const { site: activeSite } = await requireSite(org, site);

  const [run] = await db
    .select()
    .from(automationRun)
    .where(and(eq(automationRun.id, runId), eq(automationRun.siteId, activeSite.id)))
    .limit(1);
  if (!run) notFound();

  const [auto] = await db
    .select()
    .from(automation)
    .where(eq(automation.id, run.automationId))
    .limit(1);
  const [usage] = await db
    .select({
      model: usageEvent.model,
      tokensIn: usageEvent.tokensIn,
      tokensOut: usageEvent.tokensOut,
    })
    .from(usageEvent)
    .where(eq(usageEvent.requestId, run.id))
    .limit(1);

  const title =
    auto?.catalogKey === CUSTOM_KEY
      ? (auto.name ?? "Custom automation")
      : (getCatalogEntry(auto?.catalogKey ?? "")?.title ?? auto?.catalogKey ?? "Automation");
  const display = runDisplayStatus(run.status, run.resultRef);
  const changedFiles = (run.changedFiles as string[] | null) ?? [];
  const durationMs =
    run.startedAt && run.finishedAt ? run.finishedAt.getTime() - run.startedAt.getTime() : null;

  const basePath = siteHref(org, site, "automate/automations");

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-10">
      <AutomateHeader page="Routines" />

      <Link
        href={`${basePath}?tab=runs`}
        className="mt-6 inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--fg)]"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> All runs
      </Link>

      <div className="mt-4 flex items-center gap-3">
        <h1 className="text-xl font-semibold">{title}</h1>
        <span
          className={`rounded-md px-1.5 py-0.5 text-xs font-medium ${runStatusChipClass(display)}`}
        >
          {display}
        </span>
      </div>

      {/* Meta grid */}
      <div className="mt-6 grid grid-cols-2 gap-x-8 gap-y-4 rounded-xl border border-[rgba(var(--ink-rgb),0.06)] bg-[rgba(var(--ink-rgb),0.02)] p-5 text-sm sm:grid-cols-3">
        <Meta label="Trigger" value={run.triggerType.replace("_", " ")} />
        <Meta label="Queued" value={fmt(run.queuedAt)} />
        <Meta label="Finished" value={fmt(run.finishedAt)} />
        <Meta
          label="Duration"
          value={durationMs !== null ? `${Math.round(durationMs / 1000)}s` : "—"}
        />
        <Meta label="Credits" value={String(run.creditsUsed)} />
        <Meta
          label="Model"
          value={usage ? `${usage.model} (${usage.tokensIn}/${usage.tokensOut} tokens)` : "—"}
        />
        <div className="col-span-2 sm:col-span-3">
          <p className="text-xs text-[var(--muted)]">Result</p>
          <p className="mt-0.5">
            {run.resultRef ? (
              run.resultRef.startsWith("http") ? (
                <a
                  href={run.resultRef}
                  target="_blank"
                  rel="noreferrer"
                  className="text-emerald-300 underline underline-offset-2"
                >
                  {run.resultRef}
                </a>
              ) : (
                <code className="font-mono text-xs">{run.resultRef}</code>
              )
            ) : run.status === "succeeded" ? (
              <span className="text-[var(--muted)]">No changes were needed.</span>
            ) : (
              <span className="text-[var(--muted)]">—</span>
            )}
          </p>
        </div>
      </div>

      {run.error && (
        <Section title="Error">
          <pre className="whitespace-pre-wrap rounded-xl border border-red-500/25 bg-red-500/5 p-4 text-sm text-red-300">
            {run.error}
          </pre>
        </Section>
      )}

      {changedFiles.length > 0 && (
        <Section title={`Changed files (${changedFiles.length})`}>
          <ul className="space-y-1.5 rounded-xl border border-[rgba(var(--ink-rgb),0.06)] bg-[rgba(var(--ink-rgb),0.02)] p-4 text-sm">
            {changedFiles.map((f) => (
              <li key={f} className="flex items-center gap-2">
                <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" />
                <code className="font-mono text-xs">{f}</code>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {run.summary && (
        <Section title="Agent summary">
          <div className="whitespace-pre-wrap rounded-xl border border-[rgba(var(--ink-rgb),0.06)] bg-[rgba(var(--ink-rgb),0.02)] p-4 text-sm leading-relaxed">
            {run.summary}
          </div>
        </Section>
      )}

      {run.prompt && (
        <Section title="Prompt">
          <details className="rounded-xl border border-[rgba(var(--ink-rgb),0.06)] bg-[rgba(var(--ink-rgb),0.02)]">
            <summary className="cursor-pointer px-4 py-3 text-sm text-[var(--muted)] hover:text-[var(--fg)]">
              The exact instructions this run received
            </summary>
            <pre className="whitespace-pre-wrap border-t border-[rgba(var(--ink-rgb),0.06)] p-4 text-xs leading-relaxed text-[var(--muted)]">
              {run.prompt}
            </pre>
          </details>
        </Section>
      )}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className="mt-0.5">{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-8">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </div>
  );
}
