"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { DashboardErrorState } from "@/components/app/DashboardErrorState";

// Route-level boundary for the URL-scoped dashboard (/:org/:site/…). It renders INSIDE
// `[org]/layout.tsx`, so the PlatformShell + AppRail survive and only the content column
// shows the recoverable error. This is the fix for the black-screen crash (SPEC §10.7):
// a dropped RSC navigation fetch used to throw with no boundary to catch it and escalate
// to the root `global-error` (bare NextError → black full screen). Now it's caught here.
//
// We still report to Sentry, but as a handled, recovered error — the page no longer dies.
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return <DashboardErrorState error={error} reset={reset} />;
}
