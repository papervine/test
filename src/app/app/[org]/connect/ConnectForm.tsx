"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { connectRepo, type ConnectState } from "@/lib/actions/sites";
import { Button } from "@/components/platform/Button";
import { Field } from "@/components/platform/Field";
import { Switch } from "@/components/ui/switch";

const initial: ConnectState = {};

// GitHub App install state, resolved by the server component (page.tsx) and passed in so
// this stays a thin client form. `installHref` is the github.com/apps install URL (null
// when the App isn't configured — self-host without an App → PAT-only).
export type ConnectFormProps = {
  appConfigured: boolean;
  hasInstallation: boolean;
  installAccount: string | null;
  installHref: string | null;
};

export default function ConnectForm({
  appConfigured,
  hasInstallation,
  installAccount,
  installHref,
}: ConnectFormProps) {
  const [state, formAction, pending] = useActionState(connectRepo, initial);
  const orgSlug = String(useParams().org);
  // the incumbent's "docs.json is in a subdirectory" toggle. When off we don't render the
  // path field at all, so the form submits no `docsPath` and the server reads repo root.
  const [subdir, setSubdir] = useState(false);

  // On success the action returns the new site's bare URL — navigate with a hard load so
  // the app-host Host rewrite applies (a soft RSC nav would skip it; see connectRepo).
  useEffect(() => {
    if (state.redirectTo) window.location.assign(state.redirectTo);
  }, [state.redirectTo]);

  return (
    <div className="mx-auto max-w-lg px-8 py-12">
      <Link
        href={`/${orgSlug}`}
        className="text-sm text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
      >
        ← Back
      </Link>
      <h1 className="mt-4 text-2xl font-semibold">Connect a repository</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Point Papervine at a GitHub repo with a <code>docs.json</code> at its
        root. Public repos connect as-is; for a private repo,{" "}
        {appConfigured ? "install the GitHub App" : "paste a token"} below.
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

        {/* Private-repo access. Preferred path is the GitHub App (auto-rotating, no
            secret to store); the PAT field stays as a fallback (and the only option on a
            self-host with no App registered). */}
        {appConfigured &&
          (hasInstallation ? (
            <p className="rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-2.5 text-xs text-[var(--muted)]">
              GitHub App installed
              {installAccount ? (
                <>
                  {" "}
                  on <strong className="text-[var(--fg)]">{installAccount}</strong>
                </>
              ) : null}
              . Private repos in that account connect without a token. Need another
              account?{" "}
              {installHref && (
                <a href={installHref} className="underline hover:text-[var(--fg)]">
                  manage the installation
                </a>
              )}
              .
            </p>
          ) : (
            installHref && (
              <a
                href={installHref}
                className="flex items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-2.5 text-sm font-medium transition-colors hover:border-[var(--fg)]"
              >
                <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden className="size-4">
                  <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 005.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 014 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
                </svg>
                Install the GitHub App for private repos
              </a>
            )
          ))}

        <Field
          name="token"
          type="password"
          label={
            appConfigured
              ? "Access token (alternative to the App)"
              : "Access token (private repos only)"
          }
          placeholder="github_pat_…"
          autoComplete="off"
          hint={
            <span className="mt-1 block text-xs text-[var(--muted)]">
              Leave blank for public repos{appConfigured ? " or when using the App" : ""}.
              For a private repo, create a{" "}
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
