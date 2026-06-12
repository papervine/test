"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { confirmationMatches, isReasonValid } from "@/lib/danger-zone";
import {
  deleteSite,
  deleteOrganization,
  type DeleteState,
  type SiteRef,
} from "./actions";

export function DangerZone({
  siteRef,
  siteName,
  orgName,
  canDeleteSite,
  canDeleteOrg,
}: {
  siteRef: SiteRef;
  siteName: string;
  orgName: string;
  canDeleteSite: boolean;
  canDeleteOrg: boolean;
}) {
  // Plain members can't delete anything (the actions reject them) — say so rather than
  // dangle disabled buttons.
  if (!canDeleteSite && !canDeleteOrg) {
    return (
      <p className="mt-8 max-w-2xl text-sm text-[var(--muted)]">
        Only an organization owner or admin can delete a site or the organization.
      </p>
    );
  }

  return (
    <div className="mt-8 max-w-2xl space-y-10">
      {canDeleteSite && (
        <DangerSection
          title="Delete this site"
          blurb="Your site and all its deployments, analytics, and synced content will be deleted and cannot be restored. This is irreversible."
          confirmName={siteName}
          buttonLabel={`Delete ${siteName}`}
          action={(reason) => deleteSite(siteRef, reason)}
        />
      )}

      {canDeleteSite && canDeleteOrg && (
        <hr className="border-[var(--line)]" />
      )}

      {canDeleteOrg && (
        <DangerSection
          title="Delete this organization"
          blurb="Your organization will be deleted and cannot be restored. This is irreversible."
          warning="This will permanently delete your entire organization, all sites, team members, and data. This cannot be undone."
          confirmName={orgName}
          buttonLabel={`Delete ${orgName}`}
          action={(reason) => deleteOrganization(siteRef, reason)}
        />
      )}
    </div>
  );
}

function DangerSection({
  title,
  blurb,
  warning,
  confirmName,
  buttonLabel,
  action,
}: {
  title: string;
  blurb: string;
  warning?: string;
  confirmName: string;
  buttonLabel: string;
  action: (reason: string) => Promise<DeleteState>;
}) {
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);

  return (
    <section>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">{blurb}</p>

      {warning && (
        <div className="db-warn mt-4 flex items-start gap-3 rounded-xl px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--amber)]" />
          <p className="text-sm font-medium">{warning}</p>
        </div>
      )}

      <label className="mt-5 block text-sm font-medium">
        Reason for deletion <span className="text-[var(--danger)]">*</span>
      </label>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={3}
        placeholder={`Why are you deleting ${
          title.includes("organization") ? "your organization" : "your site"
        }?`}
        className="db-input mt-2 w-full resize-y rounded-xl px-3.5 py-3 text-sm outline-none"
      />

      <button
        type="button"
        disabled={!isReasonValid(reason)}
        onClick={() => setConfirming(true)}
        className="db-danger mt-4 inline-flex items-center rounded-lg px-4 py-2 text-sm font-medium"
      >
        {buttonLabel}
      </button>

      {confirming && (
        <ConfirmModal
          title={title}
          confirmName={confirmName}
          buttonLabel={buttonLabel}
          reason={reason}
          action={action}
          onClose={() => setConfirming(false)}
        />
      )}
    </section>
  );
}

function ConfirmModal({
  title,
  confirmName,
  buttonLabel,
  reason,
  action,
  onClose,
}: {
  title: string;
  confirmName: string;
  buttonLabel: string;
  reason: string;
  action: (reason: string) => Promise<DeleteState>;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the confirm field on open, and close on Escape — the SearchDialog convention.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const matched = confirmationMatches(typed, confirmName);

  function run() {
    if (!matched) return;
    setError(null);
    start(async () => {
      const res = await action(reason);
      if (res.error) {
        setError(res.error);
        return;
      }
      // Cross-context redirect: hard-navigate so the app-host Host rewrite applies (a soft
      // RSC nav would skip it and land on the apex — the documented tenant-URL gotcha).
      if (res.redirectTo) window.location.assign(res.redirectTo);
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !pending) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => !pending && onClose()}
      />
      <div className="db-feature relative z-10 w-full max-w-md rounded-2xl bg-[var(--bg)] p-6">
        <h3 className="text-base font-semibold">{title}?</h3>
        <p className="mt-2 text-sm text-[var(--muted)]">
          This action is irreversible. Type{" "}
          <span className="font-mono text-[var(--fg)]">{confirmName}</span> to confirm.
        </p>
        <input
          ref={inputRef}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          spellCheck={false}
          autoCapitalize="none"
          autoComplete="off"
          placeholder={confirmName}
          className="db-input mt-4 w-full rounded-lg px-3.5 py-2.5 text-sm outline-none"
        />

        {error && <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>}

        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="db-ring rounded-lg px-4 py-2 text-sm text-[var(--muted)] transition-colors hover:text-[var(--fg)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={run}
            disabled={!matched || pending}
            className="db-danger inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium"
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {pending ? "Deleting…" : buttonLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
