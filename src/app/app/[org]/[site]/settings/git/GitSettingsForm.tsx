"use client";

import { useState, useTransition } from "react";
import {
  ChevronDown,
  CheckCircle2,
  GitBranch,
  Settings,
  Plus,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Select } from "@/components/platform/Select";
import { gitSettingsDirty, type GitConfig } from "@/lib/git-settings";
import {
  reposForInstallation,
  branchesForRepo,
  saveGitSettings,
  type SiteRef,
} from "./actions";

// The GitHub mark — reused for the card header, the org/repo selects, and the install
// list (a local SVG keeps it crisp at every size without pulling in a brand icon set).
function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden className={className}>
      <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 005.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 014 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function GitLabMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={className}>
      <path
        fill="#e24329"
        d="M8 15.1 10.9 6.2H5.1L8 15.1Z"
      />
      <path fill="#fc6d26" d="M8 15.1 5.1 6.2H1l7 8.9Z" />
      <path
        fill="#fca326"
        d="M1 6.2 0.1 9a.6.6 0 0 0 .22.68L8 15.1 1 6.2Z"
      />
      <path fill="#e24329" d="M1 6.2h4.1L3.3.7a.3.3 0 0 0-.58 0L1 6.2Z" />
      <path fill="#fc6d26" d="M8 15.1 10.9 6.2H15L8 15.1Z" />
      <path
        fill="#fca326"
        d="M15 6.2 15.9 9a.6.6 0 0 1-.22.68L8 15.1 15 6.2Z"
      />
      <path fill="#e24329" d="M15 6.2h-4.1L12.7.7a.3.3 0 0 1 .58 0L15 6.2Z" />
    </svg>
  );
}

type Installation = {
  installationId: number;
  accountLogin: string;
  repos: { owner: string; name: string; fullName: string }[];
};
type Repo = { owner: string; name: string; fullName: string };

// The "current" sentinel for the org <select> when the site is connected by PAT/public
// (no installation). Maps to installationId = null on the wire.
const CURRENT = "current";

export function GitSettingsForm({
  siteRef,
  appConfigured,
  installHref,
  installations,
  saved,
  initialRepos,
  initialBranches,
  status,
}: {
  siteRef: SiteRef;
  appConfigured: boolean;
  installHref: string | null;
  installations: Installation[];
  saved: GitConfig;
  initialRepos: Repo[];
  initialBranches: string[];
  status: string;
}) {
  const [open, setOpen] = useState(true);

  // Draft state — the editable mirror of `saved`. orgValue is the <select> value: an
  // installationId (as string) or CURRENT for the non-App connection.
  const [orgValue, setOrgValue] = useState(
    saved.installationId != null ? String(saved.installationId) : CURRENT,
  );
  const [repos, setRepos] = useState<Repo[]>(initialRepos);
  const [repoValue, setRepoValue] = useState(
    saved.owner && saved.name ? `${saved.owner}/${saved.name}` : "",
  );
  const [branches, setBranches] = useState<string[]>(initialBranches);
  const [branch, setBranch] = useState(saved.branch);
  const [subdir, setSubdir] = useState(saved.docsPath !== "");
  const [docsPath, setDocsPath] = useState(saved.docsPath);

  const [loadingRepos, setLoadingRepos] = useState(false);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);
  const [pending, start] = useTransition();

  const installationId = orgValue === CURRENT ? null : Number(orgValue);
  const [owner, name] = repoValue.includes("/")
    ? repoValue.split("/")
    : [saved.owner, saved.name];

  const draft: GitConfig = {
    installationId,
    owner: owner ?? "",
    name: name ?? "",
    branch,
    docsPath: subdir ? docsPath : "",
  };
  const dirty = gitSettingsDirty(saved, draft);

  // Switching org → load that installation's repos, reset repo/branch selection.
  async function onOrgChange(value: string) {
    setOrgValue(value);
    setSavedOk(false);
    setError(null);
    setRepoValue("");
    setBranches([]);
    setBranch("");
    if (value === CURRENT) {
      setRepos([]);
      return;
    }
    setLoadingRepos(true);
    try {
      const r = await reposForInstallation(siteRef, Number(value));
      setRepos(r);
    } finally {
      setLoadingRepos(false);
    }
  }

  // Switching repo → load its branches, default to the first.
  async function onRepoChange(value: string) {
    setRepoValue(value);
    setSavedOk(false);
    setError(null);
    setBranches([]);
    setBranch("");
    const [o, n] = value.split("/");
    if (!o || !n) return;
    setLoadingBranches(true);
    try {
      const b = await branchesForRepo(siteRef, installationId, o, n);
      setBranches(b);
      setBranch(b[0] ?? "");
    } finally {
      setLoadingBranches(false);
    }
  }

  function onSave() {
    setError(null);
    setSavedOk(false);
    start(async () => {
      const res = await saveGitSettings(siteRef, {
        installationId,
        owner: draft.owner,
        name: draft.name,
        branch,
        docsPath: subdir ? docsPath : "",
      });
      if (res.error) setError(res.error);
      else setSavedOk(true);
    });
  }

  // The org <select> options: every installation, plus the "current" PAT/public owner
  // when the saved site isn't App-backed (so its source stays representable + editable).
  const orgOptions = [
    ...installations.map((i) => ({
      value: String(i.installationId),
      label: i.accountLogin,
    })),
    ...(saved.installationId == null && saved.owner
      ? [{ value: CURRENT, label: saved.owner }]
      : []),
  ];

  // Ensure the saved repo is selectable even if it's not in the fetched list (e.g. a
  // PAT-connected repo with no installation to enumerate from).
  const repoOptions = [...repos];
  if (
    saved.owner &&
    saved.name &&
    !repoOptions.some((r) => r.owner === saved.owner && r.name === saved.name)
  ) {
    repoOptions.unshift({
      owner: saved.owner,
      name: saved.name,
      fullName: `${saved.owner}/${saved.name}`,
    });
  }

  const live = status === "live";

  return (
    <>
      <h1 className="mt-6 text-xl font-semibold">Git settings</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Connect your deployment with your git provider.
      </p>

      <div className="mt-8 max-w-3xl space-y-4">
        {/* GitHub provider card */}
        <div className="db-feature rounded-2xl p-5">
          <div className="flex items-start gap-3">
            <GitHubMark className="mt-0.5 h-5 w-5 shrink-0 text-[var(--fg)]" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-medium">GitHub</h2>
                {live && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Active
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Configure GitHub to create deployments for any commits pushed to
                your repository
              </p>
            </div>
            <button
              type="button"
              aria-label={open ? "Collapse" : "Expand"}
              onClick={() => setOpen((o) => !o)}
              className="db-ring shrink-0 rounded-lg p-1.5 text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
            >
              <ChevronDown
                className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
              />
            </button>
          </div>

          {open && (
            <div className="mt-5 border-t border-[rgba(var(--ink-rgb),0.06)] pt-5">
              <div className="grid gap-5 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium">
                    GitHub organization
                  </span>
                  <Select
                    value={orgValue}
                    onChange={(e) => onOrgChange(e.target.value)}
                    icon={<GitHubMark className="h-4 w-4" />}
                    disabled={pending}
                  >
                    {orgOptions.length === 0 && (
                      <option value="">No organizations connected</option>
                    )}
                    {orgOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium">
                    Repository
                  </span>
                  <Select
                    value={repoValue}
                    onChange={(e) => onRepoChange(e.target.value)}
                    icon={<GitHubMark className="h-4 w-4" />}
                    disabled={pending || loadingRepos}
                  >
                    <option value="" disabled>
                      {loadingRepos ? "Loading…" : "Select a repository"}
                    </option>
                    {repoOptions.map((r) => (
                      <option key={r.fullName} value={`${r.owner}/${r.name}`}>
                        {r.name}
                      </option>
                    ))}
                  </Select>
                </label>
              </div>

              <label className="mt-5 block">
                <span className="mb-1.5 block text-sm font-medium">Branch</span>
                <Select
                  value={branch}
                  onChange={(e) => {
                    setBranch(e.target.value);
                    setSavedOk(false);
                  }}
                  icon={<GitBranch className="h-4 w-4" />}
                  disabled={pending || loadingBranches}
                >
                  <option value="" disabled>
                    {loadingBranches ? "Loading…" : "Select a branch"}
                  </option>
                  {/* Keep the saved branch selectable even if the list hasn't loaded. */}
                  {branch && !branches.includes(branch) && (
                    <option value={branch}>{branch}</option>
                  )}
                  {branches.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </Select>
              </label>

              <label className="mt-5 flex items-center gap-3 text-sm">
                <Switch
                  checked={subdir}
                  onCheckedChange={(v) => {
                    setSubdir(v);
                    setSavedOk(false);
                  }}
                />
                <span className="font-medium">docs.json is in a subdirectory</span>
              </label>

              {subdir && (
                <label className="mt-4 block">
                  <span className="mb-1.5 block text-sm font-medium">
                    Path to directory containing docs.json
                  </span>
                  <input
                    value={docsPath}
                    onChange={(e) => {
                      setDocsPath(e.target.value);
                      setSavedOk(false);
                    }}
                    placeholder="docs"
                    spellCheck={false}
                    autoCapitalize="none"
                    autoComplete="off"
                    className="db-input w-full rounded-lg px-3 py-2.5 text-sm"
                  />
                </label>
              )}

              <p className="mt-4 flex items-center gap-1.5 text-sm text-[var(--muted)]">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden
                  className="size-4 shrink-0"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 16v-4M12 8h.01" strokeLinecap="round" />
                </svg>
                Please make sure that a docs.json file exists at the selected
                repository
              </p>

              {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

              <div className="mt-5 flex items-center gap-3">
                <button
                  type="button"
                  onClick={onSave}
                  disabled={pending || !dirty || !draft.owner || !branch}
                  className="db-cta rounded-lg px-4 py-2 text-sm text-white disabled:opacity-40"
                >
                  {pending ? "Saving…" : "Save changes"}
                </button>
                {savedOk && !dirty && (
                  <span className="inline-flex items-center gap-1.5 text-sm text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" />
                    Saved — re-syncing
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* GitLab — visual parity only; not wired up (see SPEC: GitHub-first). */}
        <div className="db-feature rounded-2xl p-5 opacity-80">
          <div className="flex items-start gap-3">
            <GitLabMark className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-medium">GitLab</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Configure GitLab to create deployments for any commits pushed to
                your repository.
              </p>
              <span className="mt-2 inline-block text-sm text-[var(--muted)]/70">
                Coming soon
              </span>
            </div>
            <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-[var(--muted)]/50" />
          </div>
        </div>
      </div>

      {/* GitHub App section */}
      {appConfigured && (
        <div className="mt-12 max-w-3xl border-t border-[rgba(var(--ink-rgb),0.06)] pt-8">
          <h2 className="text-lg font-semibold">GitHub app</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Install the GitHub app to enable automatic updates.
          </p>

          <div className="mt-6 space-y-4">
            <div className="db-feature flex items-center gap-3 rounded-2xl p-5">
              <GitHubMark className="h-5 w-5 shrink-0 text-[var(--fg)]" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium">Configure GitHub App</h3>
                  {installations.length > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-400">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Installed
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  {installations.length > 0
                    ? `GitHub app installed successfully to the ${installations[0].accountLogin} organization`
                    : "Install the GitHub app to connect private repositories and get automatic deploys on push."}
                </p>
              </div>
              {installHref &&
                (installations.length > 0 ? (
                  <a
                    href={installHref}
                    aria-label="Manage GitHub App installation"
                    className="db-ring shrink-0 rounded-lg p-2 text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
                  >
                    <Settings className="h-4 w-4" />
                  </a>
                ) : (
                  <a
                    href={installHref}
                    className="db-cta shrink-0 rounded-lg px-3 py-2 text-sm text-white"
                  >
                    Install
                  </a>
                ))}
            </div>

            {installations.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-medium text-[var(--muted)]">
                  Installed organizations
                </h3>
                <div className="space-y-3">
                  {installations.map((i) => (
                    <div
                      key={i.installationId}
                      className="db-feature flex items-start gap-3 rounded-2xl p-4"
                    >
                      <GitHubMark className="mt-0.5 h-4 w-4 shrink-0 text-[var(--fg)]" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">
                          {i.accountLogin}
                        </div>
                        {i.repos.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {i.repos.slice(0, 12).map((r) => (
                              <span
                                key={r.fullName}
                                className="rounded-md bg-[rgba(var(--ink-rgb),0.06)] px-2 py-0.5 text-xs text-[var(--muted)]"
                              >
                                {r.name}
                              </span>
                            ))}
                            {i.repos.length > 12 && (
                              <span className="px-1 py-0.5 text-xs text-[var(--muted)]/70">
                                +{i.repos.length - 12} more
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      {installHref && (
                        <a
                          href={installHref}
                          aria-label={`Manage ${i.accountLogin} installation`}
                          className="db-ring shrink-0 rounded-lg p-1.5 text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
                        >
                          <Settings className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                  ))}
                </div>

                {installHref && (
                  <a
                    href={installHref}
                    className="mt-4 inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-black transition-opacity hover:opacity-90"
                  >
                    <GitHubMark className="h-4 w-4" />
                    Add to new organization
                    <Plus className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
