"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play, Plus, Settings } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { automationIcon } from "./automation-icons";
import { AutomationConfigDialog, type AutomationView } from "./AutomationConfigDialog";
import {
  runAutomationNow,
  setAutomationEnabled,
  type SiteRef,
} from "@/app/app/[org]/[site]/automate/automations/actions";

// One catalog row on the Configure tab: live toggle (optimistic, rolls back on error),
// gear → the settings dialog, and Run now when enabled. Mirrors AssistantControls'
// optimistic-toggle pattern.
export function AutomationCard({ view, siteRef }: { view: AutomationView; siteRef: SiteRef }) {
  const router = useRouter();
  const Icon = automationIcon(view.catalogKey);
  const [on, setOn] = useState(view.enabled);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => setOn(view.enabled), [view.enabled]);

  function toggle() {
    const next = !on;
    setOn(next);
    start(async () => {
      const res = await setAutomationEnabled(
        siteRef,
        { catalogKey: view.catalogKey, id: view.id ?? undefined },
        next,
      );
      if (res.error) {
        setOn(!next);
        toast.error(res.error);
        return;
      }
      router.refresh();
    });
  }

  function runNow() {
    if (!view.id) return;
    start(async () => {
      const res = await runAutomationNow(siteRef, view.id!);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(`${view.title} queued`);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-4 rounded-xl border border-[rgba(var(--ink-rgb),0.06)] bg-[rgba(var(--ink-rgb),0.02)] px-5 py-5">
      <Icon className="h-5 w-5 shrink-0 text-[var(--muted)]" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="text-[15px] font-medium">{view.title}</h3>
          {view.recommended && (
            <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-xs font-medium text-emerald-300">
              Recommended
            </span>
          )}
        </div>
        <p className="mt-1.5 text-sm text-[var(--muted)]">{view.desc}</p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {on && view.id && (
          <button
            type="button"
            title="Run now"
            disabled={pending}
            onClick={runNow}
            className="text-[var(--muted)]/70 hover:text-[var(--fg)]"
          >
            <Play className="h-[18px] w-[18px]" />
          </button>
        )}
        <Switch checked={on} disabled={pending} onCheckedChange={toggle} />
        <button
          type="button"
          title="Settings"
          onClick={() => setDialogOpen(true)}
          className="text-[var(--muted)]/70 hover:text-[var(--fg)]"
        >
          <Settings className="h-[18px] w-[18px]" />
        </button>
      </div>
      {dialogOpen && (
        <AutomationConfigDialog
          view={view}
          siteRef={siteRef}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
        />
      )}
    </div>
  );
}

// The dashed "Create a custom automation" affordance — same dialog, blank custom view.
export function CreateCustomAutomation({ siteRef }: { siteRef: SiteRef }) {
  const [open, setOpen] = useState(false);
  const blank: AutomationView = {
    catalogKey: "custom",
    id: null,
    title: "Custom automation",
    desc: "Define your own triggers, prompts, and actions to fit your team's needs.",
    enabled: false,
    allowedTriggers: ["content_update", "cron", "code_change"],
    recommendedTrigger: "content_update",
    triggerType: "content_update",
    cronExpression: null,
    triggerRepos: null,
    contextRepos: null,
    applyMode: "auto",
    additionalPrompt: null,
    extras: null,
  };
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 flex w-full items-center gap-3 rounded-xl border border-dashed border-[rgba(var(--ink-rgb),0.12)] px-5 py-4 text-left hover:border-[rgba(var(--ink-rgb),0.25)]"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[rgba(var(--ink-rgb),0.06)]">
          <Plus className="h-4 w-4 text-[var(--muted)]" />
        </span>
        <span>
          <span className="block text-sm font-medium">Create a custom automation</span>
          <span className="block text-sm text-[var(--muted)]">
            Define your own triggers, prompts, and actions to fit your team&apos;s needs.
          </span>
        </span>
      </button>
      {open && (
        <AutomationConfigDialog view={blank} siteRef={siteRef} open={open} onOpenChange={setOpen} />
      )}
    </>
  );
}
