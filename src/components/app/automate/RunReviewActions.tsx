"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, X, GitCompare } from "lucide-react";
import { toast } from "sonner";
import { siteHref } from "@/lib/dashboard-nav";
import {
  acceptRun,
  rejectRun,
  type SiteRef,
} from "@/app/app/[org]/[site]/automate/automations/actions";

// Accept / View changes / Reject for a run in `review_needed` (SPEC §10.2 in-app review).
// Accept commits the buffered draft to the deploy branch; Reject discards it; View changes
// deep-links the editor to the draft's session branch (?review=1 auto-opens the diff), landing
// on the first changed page. Shown in the run-history row and the run-detail page.
export function RunReviewActions({
  siteRef,
  runId,
  reviewBranch,
  changedFiles,
  size = "sm",
}: {
  siteRef: SiteRef;
  runId: string;
  reviewBranch: string;
  changedFiles: string[];
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  // Land the editor on the first changed doc page. Slug = repo path minus the .md(x) extension
  // (docs convention); non-page files (docs.json) are skipped.
  const firstPage = changedFiles.find((f) => /\.mdx?$/.test(f));
  const slug = firstPage ? firstPage.replace(/\.mdx?$/, "") : undefined;
  const viewHref =
    siteHref(siteRef.org, siteRef.site, "editor") +
    `?branch=${encodeURIComponent(reviewBranch)}&review=1` +
    (slug ? `&slug=${encodeURIComponent(slug)}` : "");

  const accept = () =>
    start(async () => {
      const res = await acceptRun(siteRef, runId);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Change committed");
      router.refresh();
    });
  const reject = () =>
    start(async () => {
      const res = await rejectRun(siteRef, runId);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Change rejected");
      router.refresh();
    });

  const pad = size === "md" ? "px-3 py-1.5 text-sm" : "px-2 py-1 text-xs";
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={accept}
        disabled={pending}
        className={`inline-flex items-center gap-1 rounded-md bg-emerald-500/15 font-medium text-emerald-400 transition-colors hover:bg-emerald-500/25 disabled:opacity-50 ${pad}`}
      >
        <Check className="h-3.5 w-3.5" /> Accept
      </button>
      <Link
        href={viewHref}
        className={`inline-flex items-center gap-1 rounded-md bg-[rgba(var(--ink-rgb),0.06)] font-medium text-[var(--fg)] transition-colors hover:bg-[rgba(var(--ink-rgb),0.1)] ${pad}`}
      >
        <GitCompare className="h-3.5 w-3.5" /> View changes
      </Link>
      <button
        onClick={reject}
        disabled={pending}
        className={`inline-flex items-center gap-1 rounded-md text-[var(--muted)] transition-colors hover:text-[var(--fg)] disabled:opacity-50 ${pad}`}
      >
        <X className="h-3.5 w-3.5" /> Reject
      </button>
    </div>
  );
}
