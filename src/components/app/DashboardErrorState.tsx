"use client";

import { AlertTriangle, RotateCw } from "lucide-react";
import { isNetworkError } from "@/lib/dashboard-error";

// Shared error-boundary UI for the control plane (SPEC §10). Rendered by the route-level
// `error.tsx` boundaries so a transient failure — most often a dropped RSC navigation
// fetch (TypeError: Failed to fetch) against a cold backend — degrades to a recoverable
// card instead of escalating to the root `global-error` (the black full-screen NextError).
// `reset()` re-renders just the failed segment; for a transient network blip the retry
// simply succeeds, with the platform chrome left intact.
export function DashboardErrorState({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // A dropped RSC fetch surfaces as "Failed to fetch" — name it plainly so the copy
  // reads as "the network hiccuped, try again", not "the app is broken".
  const isNetwork = isNetworkError(error.message);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-[rgba(var(--ink-rgb),0.06)]">
        <AlertTriangle aria-hidden className="size-5 text-[var(--muted)]" />
      </div>
      <h1 className="mt-4 text-base font-medium text-[var(--fg)]">
        {isNetwork ? "Couldn’t reach the server" : "Something went wrong"}
      </h1>
      <p className="mt-1.5 text-sm text-[var(--muted)]">
        {isNetwork
          ? "The connection dropped while loading this view. Your data is safe — this is usually momentary."
          : "An unexpected error interrupted this view. You can retry without losing your session."}
      </p>
      <button
        type="button"
        onClick={reset}
        className="db-cta db-ring mt-5 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm text-white"
      >
        <RotateCw aria-hidden className="size-4" />
        Try again
      </button>
      {error.digest && (
        <p className="mt-4 font-mono text-[11px] text-[var(--muted)]/70">
          Reference: {error.digest}
        </p>
      )}
    </div>
  );
}
