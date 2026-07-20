"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  CRON_PRESETS,
  CUSTOM_KEY,
  type AutomationApplyMode,
  type AutomationTriggerType,
} from "@/lib/automations/catalog";
import {
  saveAutomation,
  deleteAutomation,
  type SaveAutomationInput,
  type SiteRef,
} from "@/app/app/[org]/[site]/automate/automations/actions";

// Serializable view of an automation row + its catalog entry, prepared by the server
// page (client components can't import drizzle rows or icon components directly).
export type AutomationView = {
  catalogKey: string;
  id: string | null;
  title: string;
  desc: string;
  enabled: boolean;
  allowedTriggers: AutomationTriggerType[];
  recommendedTrigger: AutomationTriggerType;
  recommended?: boolean;
  triggerType: AutomationTriggerType;
  cronExpression: string | null;
  triggerRepos: string[] | null;
  contextRepos: string[] | null;
  applyMode: AutomationApplyMode;
  additionalPrompt: string | null;
  extras: Record<string, unknown> | null;
};

const TRIGGER_LABELS: Record<AutomationTriggerType, { title: string; desc: string }> = {
  content_update: { title: "Content update", desc: "When content is updated" },
  cron: { title: "Custom schedule", desc: "On a recurring cron schedule" },
  code_change: { title: "Code change", desc: "When a PR merges in a source repo" },
};

const splitRepos = (v: string) =>
  v
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

// The per-automation settings modal (SPEC §10.2 uniform config schema): trigger
// picker scoped to the catalog's allowedTriggers, cron chips + raw expression,
// trigger/context repos, apply mode, and the additional prompt. Custom automations add
// a name field. The primary button doubles as "Turn on" when the automation is off.
export function AutomationConfigDialog({
  view,
  siteRef,
  open,
  onOpenChange,
}: {
  view: AutomationView;
  siteRef: SiteRef;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const isCustom = view.catalogKey === CUSTOM_KEY;

  const [name, setName] = useState(view.title === "Custom automation" ? "" : view.title);
  const [triggerType, setTriggerType] = useState<AutomationTriggerType>(view.triggerType);
  const [cron, setCron] = useState(view.cronExpression ?? "0 13 * * 1");
  const [triggerRepos, setTriggerRepos] = useState((view.triggerRepos ?? []).join(", "));
  const [contextRepos, setContextRepos] = useState((view.contextRepos ?? []).join(", "));
  const [applyMode, setApplyMode] = useState<AutomationApplyMode>(view.applyMode);
  const [additionalPrompt, setAdditionalPrompt] = useState(view.additionalPrompt ?? "");

  function submit(enable: boolean) {
    const input: SaveAutomationInput = {
      catalogKey: view.catalogKey,
      id: view.id ?? undefined,
      name: isCustom ? name : undefined,
      triggerType,
      cronExpression: cron,
      triggerRepos: splitRepos(triggerRepos),
      contextRepos: splitRepos(contextRepos),
      applyMode,
      additionalPrompt,
      extras: view.extras,
      ...(enable ? { enabled: true } : {}),
    };
    start(async () => {
      const res = await saveAutomation(siteRef, input);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      if (res.warning) toast.warning(res.warning);
      else toast.success(enable ? `${isCustom ? name : view.title} turned on` : "Automation saved");
      onOpenChange(false);
      router.refresh();
    });
  }

  function remove() {
    if (!view.id) return;
    start(async () => {
      const res = await deleteAutomation(siteRef, view.id!);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Automation deleted");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            {isCustom && !view.id ? "Define custom automation" : `${view.title} settings`}
            {!view.enabled && (
              <span className="rounded-md bg-[rgba(var(--ink-rgb),0.08)] px-1.5 py-0.5 text-xs font-normal text-[var(--muted)]">
                Not set up
              </span>
            )}
          </DialogTitle>
          <p className="text-sm text-[var(--muted)]">{view.desc}</p>
        </DialogHeader>

        {isCustom && (
          <Field label="Name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My automation"
            />
          </Field>
        )}

        <Field label="When should the automation run?">
          <div className="grid gap-2">
            {view.allowedTriggers.map((t) => (
              <ChoiceCard
                key={t}
                selected={triggerType === t}
                title={TRIGGER_LABELS[t].title}
                desc={TRIGGER_LABELS[t].desc}
                badge={t === view.recommendedTrigger ? "Recommended" : undefined}
                onSelect={() => setTriggerType(t)}
              />
            ))}
          </div>
        </Field>

        {triggerType === "cron" && (
          <Field label="Schedule">
            <div className="flex flex-wrap gap-2">
              {CRON_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setCron(p.cron)}
                  className={`rounded-lg border px-3 py-1.5 text-sm ${
                    cron === p.cron
                      ? "border-emerald-500/60 bg-emerald-500/10 text-[var(--fg)]"
                      : "border-[rgba(var(--ink-rgb),0.1)] text-[var(--muted)] hover:text-[var(--fg)]"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <Input
              className="mt-2 font-mono"
              value={cron}
              onChange={(e) => setCron(e.target.value)}
              placeholder="0 13 * * 1"
            />
            <p className="mt-1 text-xs text-[var(--muted)]">
              5-field cron expression, in UTC.
            </p>
          </Field>
        )}

        {triggerType === "code_change" && (
          <Field
            label="Trigger repositories"
            hint="Runs when a PR targets the base branch or a push is made directly to it."
          >
            <Input
              value={triggerRepos}
              onChange={(e) => setTriggerRepos(e.target.value)}
              placeholder="owner/repo, owner/other-repo"
            />
          </Field>
        )}

        <Field
          label="Context repositories"
          hint="Cloned into the environment so the agent can read their code while it runs. They don't trigger the automation."
        >
          <Input
            value={contextRepos}
            onChange={(e) => setContextRepos(e.target.value)}
            placeholder="owner/repo, owner/other-repo"
          />
        </Field>

        <Field label="How should updates be applied?">
          <div className="grid gap-2">
            <ChoiceCard
              selected={applyMode === "auto"}
              title="Automatically"
              desc="Make content updates directly"
              badge="Recommended"
              onSelect={() => setApplyMode("auto")}
            />
            <ChoiceCard
              selected={applyMode === "review"}
              title="Require review"
              desc="Require approval before content updates"
              onSelect={() => setApplyMode("review")}
            />
          </div>
        </Field>

        <Field
          label="Additional prompt"
          hint="Extra instructions appended to our prompt on every run."
        >
          <Textarea
            value={additionalPrompt}
            onChange={(e) => setAdditionalPrompt(e.target.value)}
            placeholder={`Pin voice, formatting rules, or edge cases the ${
              isCustom ? "custom" : view.title.toLowerCase()
            } automation should watch for.`}
            rows={3}
          />
        </Field>

        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-xs text-[var(--muted)] underline underline-offset-2">
            Billed by usage with credits
          </span>
          <div className="flex items-center gap-2">
            {isCustom && view.id && (
              <Button variant="ghost" disabled={pending} onClick={remove}>
                Delete
              </Button>
            )}
            <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            {view.enabled ? (
              <Button disabled={pending} onClick={() => submit(false)}>
                Save
              </Button>
            ) : (
              <Button disabled={pending} onClick={() => submit(true)}>
                Turn on
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-1">
      <p className="text-sm font-medium">{label}</p>
      {hint && <p className="mt-0.5 text-xs text-[var(--muted)]">{hint}</p>}
      <div className="mt-2">{children}</div>
    </div>
  );
}

function ChoiceCard({
  selected,
  title,
  desc,
  badge,
  onSelect,
}: {
  selected: boolean;
  title: string;
  desc: string;
  badge?: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex items-center justify-between rounded-xl border px-4 py-3 text-left ${
        selected
          ? "border-emerald-500/60 bg-emerald-500/10"
          : "border-[rgba(var(--ink-rgb),0.1)] hover:border-[rgba(var(--ink-rgb),0.2)]"
      }`}
    >
      <span>
        <span className="flex items-center gap-2 text-sm font-medium">
          {title}
          {badge && (
            <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-xs font-medium text-emerald-300">
              {badge}
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-sm text-[var(--muted)]">{desc}</span>
      </span>
      <span
        aria-hidden
        className={`ml-3 h-4 w-4 shrink-0 rounded-full border ${
          selected ? "border-emerald-400 bg-emerald-400/90" : "border-[rgba(var(--ink-rgb),0.25)]"
        }`}
      />
    </button>
  );
}
