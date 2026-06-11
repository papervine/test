"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { connectRepo, type ConnectState } from "@/lib/actions/sites";
import { Button } from "@/components/platform/Button";
import { Field } from "@/components/platform/Field";
import { Switch } from "@/components/ui/switch";

const initial: ConnectState = {};

export default function ConnectRepoPage() {
  const [state, formAction, pending] = useActionState(connectRepo, initial);
  // the incumbent's "docs.json is in a subdirectory" toggle. When off we don't render the
  // path field at all, so the form submits no `docsPath` and the server reads repo root.
  const [subdir, setSubdir] = useState(false);

  return (
    <div className="mx-auto max-w-lg px-8 py-12">
      <Link
        href="/dashboard"
        className="text-sm text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
      >
        ← Back
      </Link>
      <h1 className="mt-4 text-2xl font-semibold">Connect a repository</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Point Papervine at a GitHub repo with a <code>docs.json</code> at its
        root. Public repos connect as-is; for a private repo, paste a token below.
      </p>

      <form action={formAction} className="mt-8 space-y-5">
        <Field
          name="name"
          label="Site name"
          placeholder="Acme Docs"
          autoFocus
          required
        />
        <Field
          name="repo"
          label="GitHub repository"
          placeholder="owner/name or github.com URL"
          required
        />
        <Field
          name="branch"
          label="Branch"
          placeholder="defaults to the repo's default branch"
        />

        <div className="space-y-3">
          <label className="flex items-center gap-3 text-sm">
            <Switch checked={subdir} onCheckedChange={setSubdir} />
            <span className="font-medium">docs.json is in a subdirectory</span>
          </label>
          {subdir && (
            <Field
              name="docsPath"
              label="Path to directory containing docs.json"
              placeholder="docs"
              autoComplete="off"
              autoFocus
              hint={
                <span className="mt-2 flex items-center gap-1.5 text-xs text-[var(--muted)]">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden
                    className="size-3.5 shrink-0"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 16v-4M12 8h.01" strokeLinecap="round" />
                  </svg>
                  Please make sure that a docs.json file exists at the selected
                  directory.
                </span>
              }
            />
          )}
        </div>
        <Field
          name="token"
          type="password"
          label="Access token (private repos only)"
          placeholder="github_pat_…"
          autoComplete="off"
          hint={
            <span className="mt-1 block text-xs text-[var(--muted)]">
              Leave blank for public repos. For a private repo, create a{" "}
              <a
                href="https://github.com/settings/personal-access-tokens/new"
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-[var(--fg)]"
              >
                fine-grained token
              </a>{" "}
              scoped to this repo with <strong>Contents: Read-only</strong>. It’s
              stored encrypted and used only to sync your docs.
            </span>
          }
        />

        {state.error && <p className="text-sm text-red-400">{state.error}</p>}

        <Button type="submit" full disabled={pending}>
          {pending ? "Connecting…" : "Connect repository"}
        </Button>
      </form>
    </div>
  );
}
