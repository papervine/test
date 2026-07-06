"use client";

import { useState, useTransition } from "react";
import { VenetianMask } from "lucide-react";
import { impersonateUser } from "./actions";

// Per-member "sign in as" control on the /admin member chips (SPEC §10.10). On success
// the server returns the dashboard target and we hard-navigate: the landing URL is a
// bare app-host path that only exists via the middleware Host-rewrite, which a soft
// RSC nav would skip (CLAUDE.md gotcha).
export function ImpersonateButton({ userId }: { userId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    startTransition(async () => {
      const result = await impersonateUser(userId);
      if (result.ok) {
        window.location.assign(result.redirectTo);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <>
      <button
        onClick={onClick}
        disabled={pending}
        title="Impersonate — browse as this user"
        className="inline-flex items-center gap-1 text-[var(--muted)] transition-colors hover:text-[var(--fg)] disabled:opacity-50"
      >
        <VenetianMask className="h-3.5 w-3.5" />
        {pending ? "…" : "impersonate"}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </>
  );
}
