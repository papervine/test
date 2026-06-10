"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Workflow, X } from "lucide-react";

// The Overview's "Keep your site up to date, automatically" CTA (SPEC §10.3) →
// Automate › Workflows (§10.2). Dismissible; the dismissal is remembered locally so
// it doesn't nag on every visit. (Workflows aren't built yet, so localStorage is the
// store; when they are, "configured a workflow" should suppress this server-side.)
const KEY = "pv_dismiss_workflow_upsell";

export function WorkflowUpsellBanner() {
  // Render the banner by default (matches SSR — no hydration mismatch) and hide it on
  // mount only if previously dismissed, so the common case never flashes in.
  const [show, setShow] = useState(true);
  useEffect(() => {
    if (localStorage.getItem(KEY) === "1") setShow(false);
  }, []);
  if (!show) return null;

  function dismiss() {
    localStorage.setItem(KEY, "1");
    setShow(false);
  }

  return (
    <div className="mt-8 flex items-center gap-4 rounded-xl border border-white/[0.06] bg-white/[0.02] px-5 py-4">
      <Workflow className="size-5 shrink-0 text-[var(--muted)]" />
      <p className="min-w-0 flex-1 text-sm">
        <span className="font-medium">
          Keep your site up to date, automatically
        </span>{" "}
        <span className="text-[var(--muted)]">
          Set up your first Workflow in minutes.
        </span>
      </p>
      <Link
        href="/dashboard/automate/workflows"
        className="db-ring shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--fg)]"
      >
        Start setup
      </Link>
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        className="db-ring shrink-0 rounded-md p-1 text-[var(--muted)] hover:text-[var(--fg)]"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
