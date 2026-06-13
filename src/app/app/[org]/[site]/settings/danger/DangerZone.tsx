"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { confirmationMatches, isReasonValid } from "@/lib/danger-zone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  deleteSite,
  deleteOrganization,
  type DeleteState,
  type SiteRef,
} from "./actions";

export function DangerZone({
  siteRef,
  siteSlug,
  orgSlug,
  canDeleteSite,
  canDeleteOrg,
}: {
  siteRef: SiteRef;
  siteSlug: string;
  orgSlug: string;
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
          confirmName={siteSlug}
          buttonLabel={`Delete ${siteSlug}`}
          action={(reason) => deleteSite(siteRef, reason)}
        />
      )}

      {canDeleteSite && canDeleteOrg && <Separator />}

      {canDeleteOrg && (
        <DangerSection
          title="Delete this organization"
          blurb="Your organization will be deleted and cannot be restored. This is irreversible."
          warning="This will permanently delete your entire organization, all sites, team members, and data. This cannot be undone."
          confirmName={orgSlug}
          buttonLabel={`Delete ${orgSlug}`}
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
  // The confirm step is a controlled Dialog: we own `open` so the dialog stays up while
  // the delete is pending or errors (Radix AlertDialog's Action auto-closes, which would
  // dismiss the dialog mid-request — Dialog lets us gate closing ourselves).
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const isOrg = title.includes("organization");
  const matched = confirmationMatches(typed, confirmName);

  function openConfirm(open: boolean) {
    if (pending) return; // don't let an outside-click/Escape dismiss a delete in flight
    setConfirming(open);
    if (open) {
      setTyped("");
      setError(null);
    }
  }

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
    <section>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">{blurb}</p>

      {warning && (
        <div className="db-warn mt-4 flex items-start gap-3 rounded-xl px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--amber)]" />
          <p className="text-sm font-medium">{warning}</p>
        </div>
      )}

      <Label className="mt-5 text-[var(--fg)]">
        Reason for deletion <span className="text-[var(--danger)]">*</span>
      </Label>
      <Textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={3}
        placeholder={`Why are you deleting ${isOrg ? "your organization" : "your site"}?`}
        className="mt-2 resize-y"
      />

      <Dialog open={confirming} onOpenChange={openConfirm}>
        <Button
          type="button"
          variant="danger"
          disabled={!isReasonValid(reason)}
          onClick={() => openConfirm(true)}
          className="mt-4"
        >
          {buttonLabel}
        </Button>

        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{title}?</DialogTitle>
            <DialogDescription>
              This action is irreversible. Type{" "}
              <span className="font-mono text-[var(--fg)]">{confirmName}</span> to confirm.
            </DialogDescription>
          </DialogHeader>

          <Input
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            spellCheck={false}
            autoCapitalize="none"
            autoComplete="off"
          />

          {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => openConfirm(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={run}
              disabled={!matched || pending}
            >
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {pending ? "Deleting…" : buttonLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
