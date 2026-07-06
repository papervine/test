"use client";

import { useTransition } from "react";
import { Eye, VenetianMask } from "lucide-react";
import { authClient } from "@/lib/auth-client";

// Cross-tenant awareness bar (SPEC §10.10), rendered by the [org] layout in exactly two
// states a platform operator can be in inside someone else's org:
//   view          — the read-only requireOrg bypass: browsing as yourself, not a member.
//   impersonating — a plugin-minted session: you ARE the customer until you stop.
// Always visible so a cross-tenant context can never be mistaken for your own dashboard.
export function PlatformAdminBanner({
  mode,
  name,
}: {
  mode: "view" | "impersonating";
  name: string;
}) {
  const [pending, startTransition] = useTransition();

  function stop() {
    startTransition(async () => {
      // Restores the admin's own session, then hard-navigates back to /admin — a bare
      // app-host path (Host-rewrite), so a soft nav would skip the rewrite (CLAUDE.md).
      await authClient.admin.stopImpersonating();
      window.location.assign("/admin");
    });
  }

  return (
    <div className="flex items-center justify-center gap-2 border-b border-amber-400/30 bg-amber-400/10 px-4 py-1.5 text-xs text-amber-500 dark:text-amber-300">
      {mode === "impersonating" ? (
        <>
          <VenetianMask className="h-3.5 w-3.5 shrink-0" />
          <span>
            Impersonating <strong className="font-semibold">{name}</strong> — actions
            are performed as them.
          </span>
          <button
            onClick={stop}
            disabled={pending}
            className="ml-1 rounded border border-amber-400/40 px-2 py-0.5 font-medium transition-colors hover:bg-amber-400/20 disabled:opacity-50"
          >
            {pending ? "Stopping…" : "Stop impersonating"}
          </button>
        </>
      ) : (
        <>
          <Eye className="h-3.5 w-3.5 shrink-0" />
          <span>
            Platform admin view — you&apos;re not a member of{" "}
            <strong className="font-semibold">{name}</strong>. Read-only.
          </span>
          <a
            href="/admin"
            className="ml-1 rounded border border-amber-400/40 px-2 py-0.5 font-medium transition-colors hover:bg-amber-400/20"
          >
            Back to admin
          </a>
        </>
      )}
    </div>
  );
}
