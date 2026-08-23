"use client";

import { useEffect } from "react";

// LogRocket session replay, for the control plane only.
//
// Mounted from the dashboard layout (`app/[org]/layout.tsx`) rather than the root layout, which
// is where <Analytics/> lives. That's deliberate and it is the important decision here: the root
// layout also renders every TENANT's docs site, and LogRocket doesn't count pageviews — it
// records sessions (DOM, network, console). Initialising it there would record our customers'
// READERS browsing their docs. The dashboard is both the only place it's wanted and the only
// place there's a logged-in user to identify.
//
// Two guards that matter more than the init itself:
//
//  • `appId` comes from NEXT_PUBLIC_LOGROCKET_APP_ID, never a literal. This codebase is
//    deployable by others; a hardcoded id would stream a self-hoster's users' sessions into our
//    LogRocket project. Absent env var → this renders nothing, which is also why a dev machine
//    doesn't burn session quota by default.
//
//  • `inputSanitizer` is ON. The dashboard has fields holding real credentials — the GitHub
//    token on Git settings, widget keys, the reader-auth JWT secret. Session replay records
//    input values unless told not to, so recording them verbatim would put customer secrets in
//    a third-party replay. Sanitising every input is the only safe default here; loosen it per
//    field only with a reason.
export function LogRocketInit({
  appId,
  user,
}: {
  appId: string | undefined;
  user: { id: string; name?: string | null; email?: string | null; plan?: string | null };
}) {
  useEffect(() => {
    if (!appId) return;
    let cancelled = false;
    // Dynamic import: LogRocket is a browser-only bundle and pulling it into the server graph
    // breaks the RSC build. This also keeps it out of the initial chunk.
    void import("logrocket").then(({ default: LogRocket }) => {
      if (cancelled) return;
      LogRocket.init(appId, {
        dom: { inputSanitizer: true },
      });
      LogRocket.identify(user.id, {
        ...(user.name ? { name: user.name } : {}),
        ...(user.email ? { email: user.email } : {}),
        ...(user.plan ? { plan: user.plan } : {}),
      });
    });
    return () => {
      cancelled = true;
    };
    // Re-identify if the signed-in user changes (impersonation, account switch).
  }, [appId, user.id, user.name, user.email, user.plan]);

  return null;
}
