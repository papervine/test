"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  setAssistantEnabled,
  setAssistantCaptchaEnabled,
  type AssistantActionState,
  type SiteRef,
} from "./actions";

// Client wrappers for the two DB-backed assistant toggles (SPEC §8.6). The server page is
// the source of truth — we hold an optimistic copy so the switch (and the Active/Inactive
// badge) flips instantly, then router.refresh() resyncs from the new server state. On a
// failed action we roll the optimistic value back.
function useToggle(
  initial: boolean,
  action: (ref: SiteRef, enabled: boolean) => Promise<AssistantActionState>,
  siteRef: SiteRef,
) {
  const router = useRouter();
  const [on, setOn] = useState(initial);
  const [pending, start] = useTransition();

  // Resync if the server value changes underneath us (another tab, a refresh).
  useEffect(() => setOn(initial), [initial]);

  function toggle() {
    const next = !on;
    setOn(next);
    start(async () => {
      const res = await action(siteRef, next);
      if (res.error) {
        setOn(!next);
        return;
      }
      router.refresh();
    });
  }

  return { on, pending, toggle };
}

// Status & control — the enable/disable kill switch plus the Active/Inactive badge.
export function AssistantStatusControl({
  siteRef,
  enabled,
}: {
  siteRef: SiteRef;
  enabled: boolean;
}) {
  const { on, pending, toggle } = useToggle(enabled, setAssistantEnabled, siteRef);
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Assistant Status</span>
          {on ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-xs font-medium text-emerald-300">
              <Check className="h-3 w-3" />
              Active
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-[rgba(var(--ink-rgb),0.1)] px-1.5 py-0.5 text-xs font-medium text-[var(--muted)]">
              Inactive
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Enable or disable your assistant.
        </p>
      </div>
      <Switch
        checked={on}
        onCheckedChange={toggle}
        disabled={pending}
        aria-label="Enable assistant"
      />
    </div>
  );
}

// Bot protection — the invisible CAPTCHA toggle.
export function AssistantCaptchaToggle({
  siteRef,
  enabled,
}: {
  siteRef: SiteRef;
  enabled: boolean;
}) {
  const { on, pending, toggle } = useToggle(
    enabled,
    setAssistantCaptchaEnabled,
    siteRef,
  );
  return (
    <Switch
      checked={on}
      onCheckedChange={toggle}
      disabled={pending}
      aria-label="Enable invisible CAPTCHA"
    />
  );
}
