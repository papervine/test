"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adminAdjustCredits, adminGrantPlan } from "@/lib/actions/billing";

// Client controls for the admin billing console: the plan comp and the support
// credit-adjustment form.
//
// There is no publish-to-Stripe button any more. It existed because the catalog lived in
// our Postgres and had to be pushed into Stripe; Autumn holds the catalog and provisions
// Stripe from it, so editing a plan in Autumn IS the publish. The console links out
// instead of pretending to own the catalog.

export function GrantPlanForm({
  orgs,
  plans,
}: {
  orgs: { id: string; label: string }[];
  plans: { key: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [orgId, setOrgId] = useState(orgs[0]?.id ?? "");
  const [planKey, setPlanKey] = useState(plans[0]?.key ?? "");
  const [months, setMonths] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const input =
    "rounded-lg border border-[rgba(var(--ink-rgb),0.12)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--blue)]";

  return (
    <form
      className="mt-3 flex max-w-3xl flex-wrap items-center gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setNote(null);
        start(async () => {
          const res = await adminGrantPlan({
            organizationId: orgId,
            planKey,
            months: months.trim() === "" ? null : Number(months),
            reason,
          });
          if (res.ok) {
            setNote("Granted.");
            setMonths("");
            setReason("");
            router.refresh();
          } else {
            setNote(res.error ?? "Failed.");
          }
        });
      }}
    >
      <select
        value={orgId}
        onChange={(e) => setOrgId(e.target.value)}
        className={`${input} max-w-xs`}
        aria-label="Organization"
      >
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <select
        value={planKey}
        onChange={(e) => setPlanKey(e.target.value)}
        className={input}
        aria-label="Plan"
      >
        {plans.map((p) => (
          <option key={p.key} value={p.key}>
            {p.label}
          </option>
        ))}
      </select>
      <input
        value={months}
        onChange={(e) => setMonths(e.target.value)}
        placeholder="Months (blank = forever)"
        inputMode="numeric"
        className={`${input} w-48`}
        aria-label="Months"
      />
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (required, lands on the ledger)"
        className={`${input} min-w-64 flex-1`}
        aria-label="Reason"
        required
      />
      <button
        type="submit"
        disabled={pending || !orgId || !planKey}
        className="db-cta rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? "Granting…" : "Grant plan"}
      </button>
      {note && <span className="text-sm text-[var(--muted)]">{note}</span>}
    </form>
  );
}

export function AdjustCreditsForm({
  orgs,
}: {
  orgs: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [orgId, setOrgId] = useState(orgs[0]?.id ?? "");
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const input =
    "rounded-lg border border-[rgba(var(--ink-rgb),0.12)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--blue)]";

  return (
    <form
      className="mt-3 flex max-w-3xl flex-wrap items-center gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setNote(null);
        start(async () => {
          const res = await adminAdjustCredits({
            organizationId: orgId,
            delta: Number(delta),
            reason,
          });
          if (res.ok) {
            setNote("Adjusted.");
            setDelta("");
            setReason("");
            router.refresh();
          } else {
            setNote(res.error ?? "Failed.");
          }
        });
      }}
    >
      <select
        value={orgId}
        onChange={(e) => setOrgId(e.target.value)}
        className={`${input} max-w-xs`}
        aria-label="Organization"
      >
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <input
        value={delta}
        onChange={(e) => setDelta(e.target.value)}
        placeholder="+5000 or -500"
        inputMode="numeric"
        className={`${input} w-36`}
        aria-label="Credit delta"
        required
      />
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (required, lands on the ledger)"
        className={`${input} min-w-64 flex-1`}
        aria-label="Reason"
        required
      />
      <button
        type="submit"
        disabled={pending || !orgId}
        className="db-ring rounded-lg px-4 py-2 text-sm font-medium text-[var(--fg)] disabled:opacity-50"
      >
        {pending ? "Applying…" : "Apply"}
      </button>
      {note && <span className="text-sm text-[var(--muted)]">{note}</span>}
    </form>
  );
}
