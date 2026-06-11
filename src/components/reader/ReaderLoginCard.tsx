"use client";

import { useState, useTransition } from "react";
import { Lock } from "lucide-react";
import { submitReaderPassword } from "@/lib/reader-auth-actions";

// The reader-facing sign-in card for a gated docs site (SPEC §11.2). Rendered by every
// serving mode's /login route. Today it only drives the password method; JWT/OAuth get a
// clear "not available yet" notice from the page rather than a broken form.
export function ReaderLoginCard({
  siteName,
  slug,
  redirectTo,
  method,
}: {
  siteName: string;
  slug: string;
  redirectTo: string;
  method: string | null;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await submitReaderPassword({ slug, password, redirectTo });
      if (res?.error) {
        setError(res.error);
        return;
      }
      // Full-page navigation (not router.push): the docs live on a tenant host resolved
      // by middleware from the Host header, and a soft RSC nav to "/" skips that rewrite
      // (it'd land on the apex home). A hard load re-runs middleware → tenant docs.
      window.location.assign(res.redirectTo ?? redirectTo);
    });
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-6">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          <Lock className="h-5 w-5" />
        </div>
        <h1 className="mt-5 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          {siteName}
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          This documentation is private. Enter the password to continue.
        </p>

        {method === "password" ? (
          <form onSubmit={onSubmit} className="mt-6">
            <label htmlFor="docs-password" className="sr-only">
              Password
            </label>
            <input
              id="docs-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoFocus
              autoComplete="current-password"
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-600"
            />
            <button
              type="submit"
              disabled={pending || password === ""}
              className="mt-3 w-full rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-zinc-900"
            >
              {pending ? "Checking…" : "Continue"}
            </button>
            {error && (
              <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
            )}
          </form>
        ) : (
          <p className="mt-6 rounded-lg bg-zinc-100 px-4 py-3 text-sm text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            This site uses{" "}
            <span className="font-medium">
              {method === "jwt" ? "JWT" : method === "oauth" ? "OAuth 2.0" : "custom"}
            </span>{" "}
            authentication, which isn’t available yet.
          </p>
        )}
      </div>
    </div>
  );
}
