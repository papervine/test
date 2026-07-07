"use client";

import { useState, useTransition } from "react";
import { ChevronDown, GitPullRequest, GitCommit } from "lucide-react";
import { toast } from "sonner";
import { publishDraftAction } from "@/lib/actions/authoring";
import { publishModeForBranch } from "@/lib/publish-mode";

// The Publish control. The primary action follows the selected branch, mirroring hosted docs platforms:
// on the deploy ("Default") branch Publish commits straight to it; on a working branch it
// opens a PR. The caret menu always offers both modes explicitly. Surfaces the PR link / conflict.
export function PublishButton({
  org,
  site,
  branch,
  deployBranch,
}: {
  org: string;
  site: string;
  branch: string;
  deployBranch: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  // On the deploy branch, the natural publish is a direct commit (hosted docs platforms' Publish on Default);
  // on a working branch it's a PR into the deploy branch.
  const primaryMode = publishModeForBranch(branch, deployBranch);

  const publish = (mode: "pr" | "commit") =>
    start(async () => {
      setOpen(false);
      const res = await publishDraftAction(org, site, branch, mode);
      if (res.ok && res.mode === "pr") toast.success(`Opened PR #${res.prNumber}`);
      else if (res.ok) toast.success(`Committed ${res.commitSha.slice(0, 7)} to the deploy branch`);
      // Errors linger a bit longer than the success default (more to read).
      else toast.error(res.error, { duration: 8000 });
    });

  return (
    <div className="relative">
      <div className="flex">
        <button
          type="button"
          disabled={pending}
          onClick={() => publish(primaryMode)}
          className="flex items-center gap-1.5 rounded-l-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-60"
        >
          {primaryMode === "commit" ? <GitCommit className="h-4 w-4" /> : <GitPullRequest className="h-4 w-4" />}
          {pending ? "Publishing…" : "Publish"}
        </button>
        <button
          type="button"
          aria-label="Publish options"
          onClick={() => setOpen((o) => !o)}
          className="rounded-r-md border-l border-green-700 bg-green-600 px-1.5 text-white hover:bg-green-500"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>
      {open && (
        <>
          <button className="fixed inset-0 z-10 cursor-default" aria-hidden onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-800 dark:bg-neutral-950">
            <button
              type="button"
              onClick={() => publish("pr")}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-900"
            >
              <GitPullRequest className="h-4 w-4" /> Open a pull request
            </button>
            <button
              type="button"
              onClick={() => publish("commit")}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-900"
            >
              <GitCommit className="h-4 w-4" /> Commit to the deploy branch
            </button>
          </div>
        </>
      )}
    </div>
  );
}
