"use client";

import { useEffect } from "react";

// Chatwoot live chat — OUR support channel, on our own surfaces only.
//
// Installed as the documented script snippet rather than an npm package: Chatwoot's SDK is
// delivered from the instance itself (`/packs/js/sdk.js`), so a package would only wrap a script
// tag and add a sixth dependency for nothing.
//
// Same tenant boundary as <Analytics/> and LogRocket, and it matters at least as much here: this
// widget is a support inbox WE staff. On a tenant's docs site it would invite their readers to
// open conversations with us about a product they've never heard of — and the tenant already has
// its own assistant launcher in that corner (SPEC §8.6), so the two would fight for the same
// space. The root layout gates the mount on `!isTenant`.
//
// Both values come from the environment. Absent → renders nothing, which also keeps local dev out
// of the live inbox; a hardcoded token would route a self-hoster's visitors into OUR support
// queue, exactly like the LogRocket app-id problem.
declare global {
  interface Window {
    chatwootSDK?: { run: (opts: { websiteToken: string; baseUrl: string }) => void };
    chatwootSettings?: Record<string, unknown>;
  }
}

const SCRIPT_ID = "chatwoot-sdk";

export function ChatwootWidget({
  websiteToken,
  baseUrl,
}: {
  websiteToken: string | undefined;
  baseUrl: string | undefined;
}) {
  useEffect(() => {
    if (!websiteToken || !baseUrl) return;
    // Guard on the id, not a module flag: a client-side navigation can remount this component,
    // and running the SDK twice mounts two launchers.
    if (document.getElementById(SCRIPT_ID)) return;

    // Mirrors the inbox's own snippet rather than overriding it, so what's configured in Chatwoot
    // is what ships. An earlier version forced `position: "left"` to dodge the tenant assistant
    // launcher — wrong on its own terms, since the gate on this mount means the widget never
    // renders on a tenant docs site, so there was nothing to dodge.
    window.chatwootSettings = { position: "right", type: "standard", launcherTitle: "" };

    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = `${baseUrl.replace(/\/+$/, "")}/packs/js/sdk.js`;
    script.defer = true;
    script.async = true;
    script.onload = () => window.chatwootSDK?.run({ websiteToken, baseUrl });
    document.head.appendChild(script);

    // Deliberately no cleanup that removes the script: tearing the SDK down on unmount would
    // drop an in-progress conversation on a route change. It's a singleton for the page load.
  }, [websiteToken, baseUrl]);

  return null;
}
