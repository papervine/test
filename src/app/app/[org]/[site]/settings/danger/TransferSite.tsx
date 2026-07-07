"use client";

import { useState, useTransition } from "react";
import { ArrowRightLeft, Loader2 } from "lucide-react";
import { confirmationMatches } from "@/lib/danger-zone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { TransferOption } from "@/lib/transfer-site";
import { transferSite, type SiteRef } from "./actions";

export function TransferSite({
  siteRef,
  siteSlug,
  destinations,
}: {
  siteRef: SiteRef;
  siteSlug: string;
  destinations: TransferOption[];
}) {
  const [destSlug, setDestSlug] = useState("");
  // Same controlled-Dialog pattern as DangerSection: we own `open` so the dialog survives
  // a pending/error state instead of auto-closing mid-request.
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Only an eligible pick arms the button — ineligible orgs render as disabled <option>s,
  // but guard anyway (the action re-checks the destination role server-side regardless).
  const dest = destinations.find((d) => d.slug === destSlug && d.eligible);
  const matched = confirmationMatches(typed, siteSlug);

  function openConfirm(open: boolean) {
    if (pending) return; // don't let an outside-click/Escape dismiss a transfer in flight
    setConfirming(open);
    if (open) {
      setTyped("");
      setError(null);
    }
  }

  function run() {
    if (!matched || !dest) return;
    setError(null);
    start(async () => {
      const res = await transferSite(siteRef, dest.slug);
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
      <h2 className="text-lg font-semibold">Transfer this site</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Move this site to another organization you own or administer. Its content, custom
        domain, deployments, and analytics move with it; members of the current organization
        lose access. If the site is connected through a GitHub App installation the
        destination organization doesn&apos;t have, the Git connection is dropped — reconnect
        it from Settings → Git after the transfer.
      </p>

      {destinations.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--muted)]">
          You don&apos;t belong to any other organizations, so there&apos;s nowhere to
          transfer this site. Create one, or get invited to one as an owner or admin.
        </p>
      ) : (
        <>
          <Label className="mt-5 text-[var(--fg)]">Destination organization</Label>
          <div className="mt-2 max-w-sm">
            <Select
              icon={<ArrowRightLeft className="h-4 w-4" />}
              value={destSlug}
              onChange={(e) => setDestSlug(e.target.value)}
            >
              <option value="" disabled>
                Select an organization…
              </option>
              {destinations.map((d) => (
                <option key={d.slug} value={d.slug} disabled={!d.eligible}>
                  {d.name} ({d.slug})
                  {d.eligible ? "" : " — requires owner or admin"}
                </option>
              ))}
            </Select>
          </div>
          {destinations.every((d) => !d.eligible) && (
            <p className="mt-2 text-sm text-[var(--muted)]">
              You&apos;re a member of {destinations.length === 1 ? "this organization" : "these organizations"},
              but receiving a site requires being an owner or admin there.
            </p>
          )}

          <Dialog open={confirming} onOpenChange={openConfirm}>
            <Button
              type="button"
              variant="outline"
              disabled={!dest}
              onClick={() => openConfirm(true)}
              className="mt-4"
            >
              Transfer {siteSlug}
            </Button>

            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Transfer this site?</DialogTitle>
                <DialogDescription>
                  {siteSlug} will move to <span className="text-[var(--fg)]">{dest?.name}</span>.
                  Type <span className="font-mono text-[var(--fg)]">{siteSlug}</span> to
                  confirm.
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
                <Button type="button" onClick={run} disabled={!matched || pending}>
                  {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {pending ? "Transferring…" : `Transfer ${siteSlug}`}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </section>
  );
}
