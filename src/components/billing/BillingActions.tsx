"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Switch } from "@/components/ui/switch";
import {
  changePlan,
  openBillingPortal,
  setOverageEnabled,
  setPlanCancelation,
  startPackCheckout,
} from "@/lib/actions/billing";

// Client side of the billing page: buttons that mint Checkout/Portal URLs via server
// actions and HARD-navigate to them (window.location.assign — Stripe is cross-origin,
// and the return path rides the app-host Host-rewrite a soft nav would skip; repo
// gotcha), plus the overage opt-in toggle.

function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (
    fn: () => Promise<{ ok: boolean; redirectTo?: string; changed?: boolean; error?: string }>,
  ) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res.ok && res.redirectTo) {
        window.location.assign(res.redirectTo);
        return;
      }
      if (res.ok) {
        // In-place change (plan switch / cancel) — re-render the server component.
        router.refresh();
        return;
      }
      setError(res.error ?? "Something went wrong.");
    });
  };
  return { pending, error, run };
}

const btnPrimary =
  "db-cta rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50";
const btnQuiet =
  "db-ring rounded-lg px-4 py-2 text-sm font-medium text-[var(--fg)] disabled:opacity-50";

export function BillingActions({
  orgSlug,
  canManage,
  kind,
  planKey,
  annualPlanKey,
  packKey,
  isCurrent,
}: {
  orgSlug: string;
  canManage: boolean;
  kind: "plan" | "pack" | "portal";
  planKey?: string;
  /** The annual variant's plan id, when the tier has one. */
  annualPlanKey?: string;
  packKey?: string;
  isCurrent?: boolean;
}) {
  const { pending, error, run } = useAction();

  if (kind === "portal") {
    return (
      <div className="mt-4">
        <button
          type="button"
          className={btnQuiet}
          disabled={!canManage || pending}
          onClick={() => run(() => openBillingPortal(orgSlug))}
        >
          {pending ? "Opening…" : "Manage billing"}
        </button>
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      </div>
    );
  }

  if (kind === "pack") {
    return (
      <div>
        <button
          type="button"
          className={btnQuiet}
          disabled={!canManage || pending}
          onClick={() => run(() => startPackCheckout(orgSlug, packKey!))}
        >
          {pending ? "Starting…" : "Buy"}
        </button>
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      </div>
    );
  }

  if (isCurrent) {
    return (
      <span className="inline-flex rounded-lg bg-[rgba(var(--ink-rgb),0.06)] px-4 py-2 text-sm text-[var(--muted)]">
        Current plan
      </span>
    );
  }
  // One action for every case: Autumn decides whether this is a new subscription, an
  // upgrade to prorate in place, or a downgrade to schedule, and only returns a Checkout
  // URL when it actually needs a card. Annual is a sibling plan id, not an interval.
  return (
    <div>
      <div className="flex gap-2">
        {annualPlanKey && (
          <button
            type="button"
            className={btnPrimary}
            disabled={!canManage || pending}
            onClick={() => run(() => changePlan(orgSlug, annualPlanKey))}
          >
            {pending ? "Working…" : "Choose annual"}
          </button>
        )}
        <button
          type="button"
          className={annualPlanKey ? btnQuiet : btnPrimary}
          disabled={!canManage || pending}
          onClick={() => run(() => changePlan(orgSlug, planKey!))}
        >
          {!annualPlanKey && pending ? "Working…" : "Monthly"}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}

/**
 * Downgrade-to-Free / resume, on the current-plan card. Cancel runs at period end
 * (docs keep rendering; AI stops when the plan lapses); a two-step confirm guards the
 * click. Resume undoes a pending cancellation.
 */
export function CancelPlanButton({
  orgSlug,
  canManage,
  cancelAtPeriodEnd,
  periodEndLabel,
}: {
  orgSlug: string;
  canManage: boolean;
  cancelAtPeriodEnd: boolean;
  periodEndLabel: string | null;
}) {
  const { pending, error, run } = useAction();
  const [confirming, setConfirming] = useState(false);

  // The confirm step is a transient local decision — clear it whenever the actual
  // cancel state changes (after a confirm or a resume). Without this, the `confirming`
  // flag set by "Downgrade to Free" survives the router.refresh() and, once you Resume,
  // the initial view wrongly shows "Confirm downgrade" again.
  useEffect(() => {
    setConfirming(false);
  }, [cancelAtPeriodEnd]);

  if (cancelAtPeriodEnd) {
    return (
      <div className="mt-3">
        <p className="text-sm text-[var(--muted)]">
          Downgrades to Free{periodEndLabel ? ` on ${periodEndLabel}` : " at period end"}.
        </p>
        <button
          type="button"
          className={`${btnQuiet} mt-2`}
          disabled={!canManage || pending}
          onClick={() => run(() => setPlanCancelation(orgSlug, false))}
        >
          {pending ? "Working…" : "Resume plan"}
        </button>
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mt-3">
      {confirming ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-lg border border-red-400/40 px-4 py-2 text-sm font-medium text-red-400 disabled:opacity-50"
            disabled={!canManage || pending}
            onClick={() => run(() => setPlanCancelation(orgSlug, true))}
          >
            {pending ? "Working…" : "Confirm downgrade"}
          </button>
          <button
            type="button"
            className="px-2 py-2 text-sm text-[var(--muted)] hover:text-[var(--fg)]"
            onClick={() => setConfirming(false)}
          >
            Keep plan
          </button>
        </div>
      ) : (
        // A real button, not a text caption — this rendered as quiet muted text once
        // and a user looked straight past it ("i see no way to downgrade").
        <button
          type="button"
          className={btnQuiet}
          disabled={!canManage}
          onClick={() => setConfirming(true)}
        >
          Downgrade to Free
        </button>
      )}
      <p className="mt-1.5 text-xs text-[var(--muted)]">
        Docs keep rendering on Free; AI features stop
        {periodEndLabel ? ` on ${periodEndLabel}` : " when the plan ends"}.
      </p>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}

export function OverageToggle({
  orgSlug,
  enabled: initial,
  canManage,
}: {
  orgSlug: string;
  enabled: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [enabled, setEnabled] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    const next = !enabled;
    setError(null);
    start(async () => {
      const res = await setOverageEnabled(orgSlug, next);
      if (!res.ok) {
        setError(res.error ?? "Could not update.");
        return;
      }
      setEnabled(next);
      router.refresh();
    });
  }

  return (
    <div className="mt-4 border-t border-[rgba(var(--ink-rgb),0.06)] pt-4">
      <label className="flex items-start gap-3">
        {/* shadcn Switch — structural thumb geometry (the hand-rolled toggle floated the
            thumb off the right edge). */}
        <Switch
          checked={enabled}
          onCheckedChange={toggle}
          disabled={!canManage || pending}
          className="mt-0.5"
          aria-label="Allow overage"
        />
        <span className="text-sm">
          <span className="font-medium">Allow overage</span>
          <span className="block text-[var(--muted)]">
            Off = hard cap: AI pauses when credits run out, no surprise bills. On = usage
            past the included credits is billed at your plan&rsquo;s overage rate.
          </span>
        </span>
      </label>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}
