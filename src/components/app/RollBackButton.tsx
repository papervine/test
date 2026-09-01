"use client";

import { useState, useTransition } from "react";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { rollBackSite } from "@/lib/actions/sites";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * Restore an earlier deployment (SPEC §10.11). Lives inside an Activity-feed row's detail
 * panel, so it's always attached to the specific deployment it restores.
 *
 * Confirmed rather than one-click: it changes what every reader of the site sees. The dialog
 * carries `db-portal` because Radix portals it to `<body>`, outside the `.db` platform shell,
 * where the platform palette tokens would otherwise not resolve (the two-theme gotcha).
 */
export function RollBackButton({
  siteId,
  deploymentId,
  label,
  isGitBacked,
}: {
  siteId: string;
  deploymentId: string;
  /** The target deployment's title, so the dialog names what's being restored. */
  label: string;
  /** Git sites get the extra warning: the repo still holds the newer content. */
  isGitBacked: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const res = await rollBackSite(siteId, deploymentId);
      if (res.ok) {
        setOpen(false);
        toast.success("Rolled back", {
          description: "Your site is serving this version again.",
        });
      } else {
        toast.error(res.error ?? "Couldn't roll back.");
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-3"
        onClick={() => setOpen(true)}
      >
        <RotateCcw aria-hidden className="size-3.5" />
        Roll back
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent className="db-portal">
          <AlertDialogHeader>
            <AlertDialogTitle>Roll back to this version?</AlertDialogTitle>
            <AlertDialogDescription>
              Your site will serve the content from{" "}
              <span className="font-medium text-[var(--fg)]">{label}</span> again, within
              seconds. Nothing is deleted — you can roll forward to any other deployment the
              same way.
              {isGitBacked && (
                <>
                  {" "}
                  Your repository still contains the newer content, so the next push will
                  deploy it and replace this rollback.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // Keep the dialog up while the action runs, so the button can show progress
                // instead of the dialog vanishing into an unexplained pause.
                e.preventDefault();
                confirm();
              }}
              disabled={pending}
            >
              {pending ? "Rolling back…" : "Roll back"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
