"use client";

import { useState, useTransition } from "react";
import { FlaskConical } from "lucide-react";
import { devReaderSignIn } from "@/lib/reader-auth-actions";

// DEV-ONLY reader sign-in for a JWT/OAuth-gated site (only rendered when NODE_ENV !==
// production — see the /login page). A gated site bounces real readers to the customer's IdP;
// this lets a developer become a test reader with chosen groups and verify per-page `groups:`
// (SPEC §11.2) from the browser, instead of the `sign-reader-jwt.mjs` CLI. The server action
// is itself hard-gated to non-production.
export function DevReaderSignIn({
  siteName,
  slug,
  redirectTo,
}: {
  siteName: string;
  slug: string;
  redirectTo: string;
}) {
  const [groups, setGroups] = useState("admin");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function signIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await devReaderSignIn({ slug, groups, redirectTo });
      if (res?.error) {
        setError(res.error);
        return;
      }
      // Full-page nav so middleware re-runs the tenant Host rewrite (see the CLAUDE.md gotcha).
      window.location.assign(res.redirectTo ?? redirectTo);
    });
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-6">
      <div className="w-full max-w-sm rounded-2xl border border-amber-300 bg-amber-50 p-8 shadow-sm dark:border-amber-700/60 dark:bg-amber-950/30">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
          <FlaskConical className="h-5 w-5" />
        </div>
        <h1 className="mt-5 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Dev sign-in · {siteName}
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          This site uses JWT auth, which needs your own login flow. For local testing, sign in
          as a test reader with the groups below — no IdP required.
          <span className="mt-1 block text-xs text-amber-700 dark:text-amber-400">
            Dev only · never available in production.
          </span>
        </p>

        <form onSubmit={signIn} className="mt-6">
          <label htmlFor="dev-groups" className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            Groups
          </label>
          <p className="mb-2 mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            Comma-separated (e.g. <code className="font-mono">admin</code>,{" "}
            <code className="font-mono">beta</code>). Leave blank for a reader with no groups.
          </p>
          <input
            id="dev-groups"
            value={groups}
            onChange={(e) => setGroups(e.target.value)}
            placeholder="admin, beta"
            autoFocus
            spellCheck={false}
            autoCapitalize="none"
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-amber-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
          />
          <button
            type="submit"
            disabled={pending}
            className="mt-3 w-full rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Signing in…" : "Sign in as test reader"}
          </button>
          {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
        </form>
      </div>
    </div>
  );
}
