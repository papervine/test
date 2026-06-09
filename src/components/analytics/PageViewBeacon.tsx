"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

// Per-browser visitor id for distinct-visitor counts. A coarse first-party id (not a
// login, not cross-site) stored locally; SPEC §10.1 "respect noindex/privacy".
const VID_KEY = "db_vid";

function visitorId(): string {
  try {
    let id = localStorage.getItem(VID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(VID_KEY, id);
    }
    return id;
  } catch {
    return "anon";
  }
}

/**
 * Fires a human page-view to /api/events on each docs navigation. Mounted in the
 * tenant docs page; only humans (who run JS) reach it — agents are logged
 * server-side, which is what makes the Humans-vs-Agents toggle meaningful.
 */
export function PageViewBeacon() {
  const pathname = usePathname();

  useEffect(() => {
    fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: pathname,
        sessionId: visitorId(),
        referrer: document.referrer || undefined,
      }),
      keepalive: true, // survive the navigation that triggered it
    }).catch(() => {});
  }, [pathname]);

  return null;
}
