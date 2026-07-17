"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adminAdjustCredits, adminPublishToStripe } from "@/lib/actions/billing";

// Client controls for the admin billing console: publish-to-Stripe and the support
// credit-adjustment form (actor + reason land on the ledger entry).

export function PublishButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={pending}
        className="db-cta rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        onClick={() => {
          setNote(null);
          start(async () => {
            const res = await adminPublishToStripe();
            setNote(
              res.ok
                ? `Published: ${res.products} products, ${res.prices} prices created.`
                : (res.error ?? "Publish failed."),
            );
            if (res.ok) router.refresh();
          });
        }}
      >
        {pending ? "Publishing…" : "Publish to Stripe"}
      </button>
      {note && <span className="text-sm text-[var(--muted)]">{note}</span>}
    </div>
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
