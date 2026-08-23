"use client";

import { useEffect, useState, useTransition } from "react";
import { Github, GitBranch, ArrowRight, Check, Sparkles, Wrench } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/platform/Button";
import { Field } from "@/components/platform/Field";
import { Switch } from "@/components/ui/switch";
import { Combobox } from "@/components/platform/Combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  convertToGit,
  startRepoCreation,
  inspectRepoForHandover,
  type SiteRef,
} from "./actions";
import type { HandoverResolution } from "@/lib/git-handover";

export type Repo = { owner: string; name: string; fullName: string };

export type Installation = {
  installationId: number;
  accountLogin: string | null;
  /** Repos this installation can reach — the Repository dropdown's options. */
  repos: Repo[];
};

/**
 * "Connect to GitHub" for a Papervine-hosted site (SPEC §10.11) — the surface that used to
 * be a 404 here, which is exactly where people looked for it.
 *
 * The operation is a hand-over, not a re-point: the site's current content is committed into
 * an **empty** repo as its first commit, then the site becomes Git-backed. Two ways to get
 * that repo — we create it (needs a user access token, so only when this deployment carries
 * the App's client credentials), or you create it and paste `owner/name`.
 *
 * Installing the GitHub App sits ABOVE the choice, because both paths need it: the push after
 * creation uses an installation token, and a user access token only reaches repositories the
 * installation covers. Burying it inside one tab meant the default view offered no way to
 * install the App at all.
 */
export function ConnectToGitHubForm({
  siteRef,
  siteName,
  suggestedRepoName,
  appConfigured,
  canCreateRepo,
  installHref,
  installations,
  notice,
}: {
  siteRef: SiteRef;
  siteName: string;
  /** Seeds the new-repo name field — the site's slug is almost always what people want. */
  suggestedRepoName: string;
  appConfigured: boolean;
  /** GITHUB_APP_CLIENT_* present, so we can create the repo on the owner's behalf. */
  canCreateRepo: boolean;
  installHref: string | null;
  installations: Installation[];
  /** Result of a returning one-click round trip, read off the query string server-side. */
  notice: { connected?: string; error?: string };
}) {
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"create" | "manual">(canCreateRepo ? "create" : "manual");
  const [newRepo, setNewRepo] = useState(suggestedRepoName);
  const [isPrivate, setIsPrivate] = useState(false);
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("");
  const [branches, setBranches] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);
  // Whether the selected repo can actually be adopted, answered when it's picked rather
  // than after they fill in a branch and press Connect.
  const [check, setCheck] = useState<{ empty: boolean; hasDocsConfig: boolean } | null>(null);
  const [installationId, setInstallationId] = useState<number | null>(
    installations[0]?.installationId ?? null,
  );
  const [error, setError] = useState<string | null>(notice.error ?? null);
  const [conflictOpen, setConflictOpen] = useState(false);

  const installed = installations.length > 0;
  const current = installations.find((i) => i.installationId === installationId) ?? installations[0];
  const repos = current?.repos ?? [];

  // Picking a repo loads its branches AND checks it's empty enough to adopt — one round trip
  // (see inspectRepoForHandover), because both answers come from the same GitHub calls.
  const onRepoChange = async (value: string) => {
    setRepo(value);
    setError(null);
    setBranch("");
    setBranches([]);
    setCheck(null);
    const [owner, name] = value.split("/");
    if (!owner || !name) return;
    setChecking(true);
    try {
      const res = await inspectRepoForHandover(siteRef, installationId, owner, name);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setBranches(res.branches);
      setBranch(res.defaultBranch);
      setCheck({ empty: res.empty, hasDocsConfig: res.hasDocsConfig });
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (notice.connected) toast.success(`Connected ${notice.connected}.`);
  }, [notice.connected]);

  const createRepo = () => {
    setError(null);
    start(async () => {
      const res = await startRepoCreation(siteRef, { repo: newRepo, private: isPrivate });
      if (res.error || !res.authorizeUrl) {
        setError(res.error ?? "Couldn't start GitHub authorization.");
        return;
      }
      // Off to github.com to authorize; the callback creates the repo, hands the content
      // over, and redirects back here.
      window.location.assign(res.authorizeUrl);
    });
  };

  // `resolution` is only sent once the owner has answered the which-source-wins prompt; the
  // server refuses (needsResolution) rather than guessing, so a first attempt on a non-empty
  // repo opens the dialog instead of failing.
  const connectExisting = (resolution?: HandoverResolution) => {
    setError(null);
    // `repo` comes from the select, so it's always exactly "owner/name" — no URL or
    // whitespace shapes to normalize.
    const [owner, name] = repo.split("/");
    if (!owner || !name) {
      setError("Choose a repository.");
      return;
    }
    start(async () => {
      const res = await convertToGit(siteRef, {
        installationId,
        owner,
        name,
        branch: branch.trim() || undefined,
        resolution,
      });
      if (res.needsResolution) {
        setConflictOpen(true);
        return;
      }
      if (res.error) {
        setConflictOpen(false);
        setError(res.error);
        return;
      }
      toast.success(
        res.backedUpTo
          ? `Connected. Your previous pages are on the ${res.backedUpTo} branch.`
          : "Connected — your content is now in GitHub.",
      );
      // The site is Git-backed now, so this page becomes the repo form; a hard load picks up
      // the new server render (and keeps the app-host rewrite, per CLAUDE.md).
      window.location.reload();
    });
  };

  return (
    <div className="mt-6 max-w-xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Connect to GitHub</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          <strong className="text-[var(--fg)]">{siteName}</strong> is hosted by Papervine — its
          content lives here rather than in a repository. Connecting moves it to GitHub: we
          commit everything this site currently publishes into a repo you own, then keep the
          two in step from then on.
        </p>
      </div>

      {/* Prerequisite for BOTH paths, so it sits above the choice. */}
      <div className="rounded-xl border border-[var(--line)] bg-[var(--card)] p-4 text-sm">
        <div className="font-medium">GitHub access</div>
        {installed ? (
          <div className="mt-2 space-y-3">
            <p className="inline-flex items-center gap-1.5 text-[var(--muted)]">
              <Check className="size-3.5 text-emerald-400" />
              GitHub App installed
              {installations[0].accountLogin ? (
                <>
                  {" on "}
                  <strong className="text-[var(--fg)]">{installations[0].accountLogin}</strong>
                </>
              ) : null}
              .
            </p>
            {installations.length > 1 && (
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-[var(--muted)]">
                  GitHub account
                </span>
                <select
                  className="db-input w-full rounded-lg px-3 py-2 text-sm"
                  value={installationId ?? ""}
                  onChange={(e) => {
                    // Repos are per-installation, so a stale selection would point at a
                    // repo this account can't reach.
                    setInstallationId(Number(e.target.value));
                    setRepo("");
                    setBranch("");
                    setBranches([]);
                    setCheck(null);
                  }}
                >
                  {installations.map((i) => (
                    <option key={i.installationId} value={i.installationId}>
                      {i.accountLogin ?? `Installation ${i.installationId}`}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {installHref && (
              <a
                href={installHref}
                className="block text-xs text-[var(--muted)] underline hover:text-[var(--fg)]"
              >
                Add another account or repository
              </a>
            )}
          </div>
        ) : (
          <div className="mt-2">
            <p className="text-[var(--muted)]">
              Papervine needs write access to push your content. Install the GitHub App on your
              account — choosing <strong className="text-[var(--fg)]">All repositories</strong>{" "}
              means a repository created here is covered automatically.
            </p>
            {appConfigured && installHref ? (
              <a
                href={installHref}
                className="mt-3 inline-flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--card)] px-3 py-2 text-sm font-medium transition-colors hover:border-[var(--fg)]"
              >
                <Github className="size-4" />
                Install the GitHub App
              </a>
            ) : (
              <p className="mt-2 text-xs text-[var(--muted)]">
                No GitHub App is configured for this deployment — an operator needs to set the{" "}
                <code>GITHUB_APP_*</code> variables before a site can be connected.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Creating the repo needs the App to act AS you (a user access token — installation
          tokens can't create repos), so the choice only appears when this deployment carries
          the App's client credentials. */}
      {canCreateRepo && (
        <div className="flex gap-2">
          {(
            [
              { key: "create", label: "Create a repo for me", icon: Sparkles },
              // NOT "I'll make it myself": this is also the path for a repo you already
              // have, and the old label read as "create" — so anyone looking to link an
              // existing repo saw no option for it and concluded there wasn't one.
              { key: "manual", label: "Use an existing repo", icon: Wrench },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setMode(tab.key)}
              aria-pressed={mode === tab.key}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors",
                mode === tab.key
                  ? "border-[var(--blue)] bg-[rgba(var(--ink-rgb),0.05)] font-medium"
                  : "border-[var(--line)] text-[var(--muted)] hover:border-[rgba(var(--ink-rgb),0.2)]",
              )}
            >
              <tab.icon className="size-3.5" />
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {mode === "create" ? (
        <div className="space-y-5 rounded-xl border border-[var(--line)] bg-[var(--card)] p-4">
          <p className="text-sm text-[var(--muted)]">
            Papervine will create a new repository on your GitHub account and commit this
            site’s content into it. You’ll be asked to authorize the app first.
          </p>
          <Field
            label="Repository name"
            placeholder="acme-docs"
            value={newRepo}
            onChange={(e) => setNewRepo(e.target.value)}
            disabled={pending}
          />
          <label className="flex items-center gap-3 text-sm">
            <Switch checked={isPrivate} onCheckedChange={setIsPrivate} disabled={pending} />
            <span>
              <span className="font-medium">Private repository</span>
              <span className="mt-0.5 block text-xs text-[var(--muted)]">
                Your docs site stays as public or gated as it is now — this only affects who
                can see the source on GitHub.
              </span>
            </span>
          </label>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Button full disabled={pending || !newRepo.trim()} onClick={createRepo}>
            {pending ? "Taking you to GitHub…" : "Create repository and connect"}
          </Button>
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          {/* Leads with the ACTION, not with instructions to go create something: this tab
              serves both "I already made an empty repo" and "I have a repo lying around",
              and burying the field under a "create one first" step made the whole path look
              like it wasn't for either of them. */}
          <div className="rounded-xl border border-[var(--line)] bg-[var(--card)] p-4">
            <div className="font-medium">Point this site at a repository</div>
            <div className="mt-3 space-y-4">
              <div>
                <span className="mb-1 block text-sm font-medium text-[var(--muted)]">
                  Repository
                </span>
                <Combobox
                  ariaLabel="Repository"
                  value={repo}
                  onValueChange={(v) => void onRepoChange(v)}
                  options={repos.map((r) => ({ value: r.fullName, label: r.fullName }))}
                  placeholder={
                    repos.length === 0
                      ? "No repositories — grant the App access to one"
                      : "Choose a repository…"
                  }
                  searchPlaceholder="Search repositories"
                  emptyText="No repositories match."
                  icon={<Github className="size-4 shrink-0 text-[var(--muted)]" aria-hidden />}
                  disabled={pending || repos.length === 0}
                />
                {installHref && (
                  <a
                    href={installHref}
                    className="mt-1 block text-xs text-[var(--muted)] underline hover:text-[var(--fg)]"
                  >
                    Don’t see it? Grant the App access to more repositories
                  </a>
                )}
              </div>

              <div>
                <span className="mb-1 block text-sm font-medium text-[var(--muted)]">Branch</span>
                <Combobox
                  ariaLabel="Branch"
                  value={branch}
                  onValueChange={setBranch}
                  options={branches.map((b) => ({ value: b, label: b }))}
                  placeholder={checking ? "Loading…" : "Pick a repository first"}
                  searchPlaceholder="Search branches"
                  emptyText="No branches match."
                  icon={<GitBranch className="size-4 shrink-0 text-[var(--muted)]" aria-hidden />}
                  disabled={pending || checking || branches.length === 0}
                />
              </div>

              {/* What we found, at the moment they pick it — so a non-empty repo is a
                  heads-up here rather than a surprise on submit. */}
              {check && !check.empty && (
                <p className="text-sm text-amber-400">
                  This repository already has content. You’ll be asked which version to keep.
                </p>
              )}
              {check?.empty && (
                <p className="inline-flex items-center gap-1.5 text-sm text-emerald-400">
                  <Check className="size-3.5" />
                  This repository is empty — ready to receive your content.
                </p>
              )}
            </div>
          </div>

          {/* Set expectations before they submit. An empty repo just works; a non-empty one
              is a question we ask rather than a rule we enforce. */}
          <div className="rounded-xl border border-[var(--line)] bg-[var(--card)] p-4 text-[var(--muted)]">
            <p>
              An <strong className="text-[var(--fg)]">empty</strong> repository is the simple
              case — this site’s content becomes its first commit.
            </p>
            <p className="mt-2">
              If the repository already has docs in it, we’ll ask which version is the one to
              keep. Nothing is discarded either way: whichever side loses is preserved in Git.
            </p>
            <a
              href="https://github.com/new"
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-[var(--blue)] hover:opacity-80"
            >
              Create an empty repository on GitHub <ArrowRight className="size-3.5" />
            </a>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <Button
            full
            // A non-empty repo no longer blocks the button — pressing it opens the
            // which-source-wins prompt instead (the server returns needsResolution).
            disabled={pending || checking || !installed || !repo}
            onClick={() => connectExisting()}
          >
            {pending ? "Connecting…" : "Connect to GitHub"}
          </Button>
        </div>
      )}

      <p className="text-xs text-[var(--muted)]">
        Nothing is deleted. Your content is committed to the repository, and from then on Git is
        the source of truth — pushes rebuild the site, and Studio publishes as a commit or a
        pull request.
      </p>

      {/* Both sides hold real docs, so this is the owner's call — the server refuses to guess
          (needsResolution) and we ask here. Framed as "which is correct", not "overwrite?",
          because the destructive-sounding word isn't the useful question. */}
      <Dialog open={conflictOpen} onOpenChange={setConflictOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Which content is the one to keep?</DialogTitle>
            <DialogDescription>
              <strong className="text-[var(--fg)]">{repo}</strong> already has docs in it, and so
              does this site. Pick the version that should be live from now on — the other one
              stays recoverable in Git.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            <button
              type="button"
              disabled={pending}
              onClick={() => connectExisting("local")}
              className="w-full rounded-xl border border-[var(--line)] bg-[var(--card)] p-4 text-left transition-colors hover:border-[var(--blue)] disabled:opacity-60"
            >
              <span className="block font-medium">Keep this site’s content</span>
              <span className="mt-1 block text-xs text-[var(--muted)]">
                Your Papervine pages are committed over the repository’s. What was there stays in
                the repo’s history, so nothing is lost — it just stops being what the site serves.
              </span>
            </button>

            <button
              type="button"
              disabled={pending || !check?.hasDocsConfig}
              onClick={() => connectExisting("repo")}
              className="w-full rounded-xl border border-[var(--line)] bg-[var(--card)] p-4 text-left transition-colors hover:border-[var(--blue)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="block font-medium">Keep the repository’s content</span>
              <span className="mt-1 block text-xs text-[var(--muted)]">
                {check?.hasDocsConfig
                  ? `The site adopts the repository and starts serving it. Your current pages are
                     committed to the ${"papervine/hosted-content"} branch first, since — unlike the
                     repo's files — they have no history to fall back on.`
                  : `Not available: this repository has no docs.json or mint.json, so there'd be no
                     config for the site to render from.`}
              </span>
            </button>
          </div>

          <DialogFooter>
            <Button variant="ghost" disabled={pending} onClick={() => setConflictOpen(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
