"use client";

import { useEffect } from "react";
import { ensureLogRocket } from "./logrocket-client";

// LogRocket session replay. Mounted twice, on purpose:
//
//  • the ROOT layout, with no `user` — so replay covers everything we own: marketing, pricing,
//    the auth pages, onboarding, /admin and the dashboard. Anonymous until the person signs in.
//  • the DASHBOARD layout, with `user` — the only place a session exists, so it's the only place
//    that can say who the recording is of. ensureLogRocket dedupes the init between them.
//
// The root layout also renders every TENANT's docs site, so the mount there is gated on
// `!isTenant` exactly like <Analytics/>. That gate is the load-bearing part: replay records the
// DOM, network and console, so on a tenant page it would be recording our customers' READERS
// browsing their own documentation.
//
// `appId` is always NEXT_PUBLIC_LOGROCKET_APP_ID, never a literal: this codebase is deployable by
// others, and a hardcoded id would stream a self-hoster's users' sessions into our project.
// Absent env var → renders nothing, which also keeps dev machines off the session quota.
export function LogRocketInit({
  appId,
  user,
}: {
  appId: string | undefined;
  user?: { id: string; name?: string | null; email?: string | null; plan?: string | null };
}) {
  const { id, name, email, plan } = user ?? {};

  useEffect(() => {
    let cancelled = false;
    void ensureLogRocket(appId).then((LogRocket) => {
      if (!LogRocket || cancelled || !id) return;
      LogRocket.identify(id, {
        ...(name ? { name } : {}),
        ...(email ? { email } : {}),
        ...(plan ? { plan } : {}),
      });
    });
    return () => {
      cancelled = true;
    };
    // Re-identify if the signed-in user changes (impersonation, account switch).
  }, [appId, id, name, email, plan]);

  return null;
}
