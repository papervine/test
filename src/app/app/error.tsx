"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { DashboardErrorState } from "@/components/app/DashboardErrorState";

// Backstop boundary for the whole app-host mount (SPEC §10.7). The per-org boundary
// (`[org]/error.tsx`) catches page/navigation failures inside the dashboard shell; this
// one catches failures that escape it — most notably an error thrown in `[org]/layout.tsx`
// itself (which a sibling error.tsx can't catch). Because it renders ABOVE that layout,
// there's no PlatformShell around it yet, so it wraps itself in one — otherwise it would
// paint unstyled on the dark page, which is the exact black-screen failure we're killing.
// (redirect()/notFound() from requireOrg are re-thrown by the boundary, not swallowed.)
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <PlatformShell variant="lite">
      <div className="min-h-screen">
        <DashboardErrorState error={error} reset={reset} />
      </div>
    </PlatformShell>
  );
}
