"use client";

import { useState, useTransition } from "react";
import { GitBranch, Plus, Check } from "lucide-react";
import { checkoutBranchAction } from "@/lib/actions/authoring";

// Branch dropdown (mirrors a comparable hosted docs platform editor's branch picker): the deploy branch, the
// open edit sessions, and "Create new branch". Switching navigates the editor to that
// branch (its drafts); creating mints a fresh working branch via the authoring backend.
export function BranchSwitcher({
  org,
  site,
  branch,
  sessionBranches,
  deployBranch,
  onSwitch,
}: {
  org: string;
  site: string;
  branch: string;
  sessionBranches: string[];
  deployBranch: string;
  onSwitch: (branch: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const create = () =>
    start(async () => {
      const res = await checkoutBranchAction(org, site, undefined);
      if ("branch" in res) {
        onSwitch(res.branch);
        setOpen(false);
      }
    });

  const branches = [deployBranch, ...sessionBranches.filter((b) => b !== deployBranch)];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm dark:border-neutral-700"
      >
        <GitBranch className="h-3.5 w-3.5" />
        <span className="max-w-[12rem] truncate">{branch}</span>
      </button>
      {open && (
        <>
          <button className="fixed inset-0 z-10 cursor-default" aria-hidden onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-20 mt-1 w-64 rounded-lg border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-800 dark:bg-neutral-950">
            {branches.map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => {
                  onSwitch(b);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-900"
              >
                <span className="w-4">{b === branch && <Check className="h-3.5 w-3.5" />}</span>
                <span className="truncate">{b}</span>
                {b === deployBranch && (
                  <span className="ml-auto rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                    Default
                  </span>
                )}
              </button>
            ))}
            <button
              type="button"
              disabled={pending}
              onClick={create}
              className="mt-1 flex w-full items-center gap-2 rounded-md border-t border-neutral-200 px-2 py-2 text-left text-sm font-medium hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
            >
              <Plus className="h-3.5 w-3.5" />
              {pending ? "Creating…" : "Create new branch"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
