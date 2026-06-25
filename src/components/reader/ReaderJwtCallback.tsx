"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import { submitReaderJwt } from "@/lib/reader-auth-actions";

// Lands at /login/jwt-callback after the customer's backend signs an EdDSA JWT and
// redirects here with the token in the URL **hash** (SPEC §11.2). The hash never reaches
// the server, so we read it client-side and post it to the server action to verify + set
// the session cookie, then hard-navigate to the intended page (a soft RSC nav would skip
// the tenant Host rewrite — see the CLAUDE.md gotcha). The token is dropped from the URL
// before navigating so it isn't left in history.
export function ReaderJwtCallback({
  slug,
  redirectTo,
}: {
  slug: string;
  redirectTo: string;
}) {
  const [error, setError] = useState<string | null>(null);
  // StrictMode double-invokes effects in dev; guard so we don't submit the one-time token
  // twice (the second would still verify, but it's wasteful and confusing).
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const token = window.location.hash.replace(/^#/, "");
    if (!token) {
      setError("No sign-in token was provided.");
      return;
    }

    void (async () => {
      const res = await submitReaderJwt({ slug, token, redirectTo });
      if (res?.error) {
        setError(res.error);
        return;
      }
      window.location.assign(res.redirectTo ?? redirectTo);
    })();
  }, [slug, redirectTo]);

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-6">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        {error ? (
          <>
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <h1 className="mt-5 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Couldn’t sign you in
            </h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{error}</p>
          </>
        ) : (
          <>
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
            <h1 className="mt-5 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Signing you in…
            </h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Verifying your access. This only takes a moment.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
