"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { regenerateSkill } from "../actions";

/**
 * Per-site "Regenerate" control on Operator → Skills (SPEC §9.1).
 *
 * The hourly sweep deliberately skips a site whose capability fingerprint hasn't moved — right
 * for a background job, useless when you're looking at a generation that got something wrong.
 * This forces one.
 *
 * Queued, not awaited: the work is a Trigger task that can take a minute, so the button reports
 * that it started rather than pretending to know how it went. `router.refresh()` is what brings
 * the new timestamp back into the table, on the next look.
 */
export function RegenerateButton({ siteId, authored }: { siteId: string; authored: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<"idle" | "queued" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  // Nothing to regenerate: the repo ships its own file, which always wins. Disabled rather than
  // hidden, because "why is there no button here" is a worse question than a tooltip.
  if (authored) {
    return (
      <span className="text-xs text-[var(--muted)]" title="This site publishes its own skill.md">
        authored
      </span>
    );
  }

  function onClick() {
    setError(null);
    startTransition(async () => {
      const result = await regenerateSkill(siteId);
      if (result.ok) {
        setState("queued");
        router.refresh();
      } else {
        setState("error");
        setError(result.error);
      }
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[rgba(var(--ink-rgb),0.08)] px-2.5 py-1.5 text-xs text-[var(--muted)] transition-colors hover:text-[var(--fg)] disabled:opacity-50"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${pending ? "animate-spin" : ""}`} />
        {pending ? "Starting…" : "Regenerate"}
      </button>
      {state === "queued" && <span className="text-xs text-[var(--muted)]">queued</span>}
      {state === "error" && <span className="text-xs text-red-400">{error}</span>}
    </span>
  );
}
