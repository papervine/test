"use client";

import { useState } from "react";
import { Field } from "@/components/platform/Field";
import { Switch } from "@/components/ui/switch";

// GitHub App install state, resolved by the server component (page.tsx) and passed in so
// this stays presentational. `installHref` is the github.com/apps install URL (null when no
// App is configured for this deployment — falls back to PAT-only).
export type GitConnectFieldsProps = {
  appConfigured: boolean;
  hasInstallation: boolean;
  installAccount: string | null;
  installHref: string | null;
};

/**
 * The "Connect a GitHub repo" fields of the add-site chooser (SPEC §10.11) — extracted from
 * the old single-purpose connect form unchanged, so this path behaves exactly as it always
 * has. Deliberately renders no <form>, heading, or submit button: the chooser owns those,
 * because the primary button lives below the card list and reaches the selected card's form
 * through the HTML `form=` attribute.
 */
export function GitConnectFields({
  appConfigured,
  hasInstallation,
  installAccount,
  installHref,
}: GitConnectFieldsProps) {
  // hosted docs platforms' "docs.json is in a subdirectory" toggle. When off we don't render
  // the path field at all, so the form submits no `docsPath` and the server reads repo root.
  const [subdir, setSubdir] = useState(false);

  return (
    <>
      <p className="text-sm text-[var(--muted)]">
        Point Papervine at a GitHub repo with a <code>docs.json</code> at its root. Public
        repos connect as-is; for a private repo,{" "}
        {appConfigured ? "install the GitHub App" : "paste a token"} below.
      </p>

      <Field name="name" label="Site name" placeholder="Acme Docs" required />
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
                Please make sure that a docs.json file exists at the selected directory.
              </span>
            }
          />
        )}
      </div>

      {/* Private-repo access. Preferred path is the GitHub App (auto-rotating, no secret to
          store); the PAT field stays as a fallback (and the only option on a deployment
          with no App registered). */}
      {appConfigured &&
        (hasInstallation ? (
          <p className="rounded-lg border border-[var(--line)] bg-[var(--card)] px-3 py-2.5 text-xs text-[var(--muted)]">
            GitHub App installed
            {installAccount ? (
              <>
                {" "}
                on <strong className="text-[var(--fg)]">{installAccount}</strong>
              </>
            ) : null}
            . Private repos in that account connect without a token. Need another account?{" "}
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
              className="flex items-center justify-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--card)] px-3 py-2.5 text-sm font-medium transition-colors hover:border-[var(--fg)]"
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
            Leave blank for public repos{appConfigured ? " or when using the App" : ""}. For a
            private repo, create a{" "}
            <a
              href="https://github.com/settings/personal-access-tokens/new"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-[var(--fg)]"
            >
              fine-grained token
            </a>{" "}
            scoped to this repo with <strong>Contents: Read-only</strong>. It’s stored
            encrypted and used only to sync your docs.
          </span>
        }
      />
    </>
  );
}
