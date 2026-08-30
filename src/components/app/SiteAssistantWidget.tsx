"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { parseSitePath, pickCurrentSite } from "@/lib/dashboard-nav";
import {
  loadPapervineWidget,
  platformWidgetTheme,
  watchPlatformTheme,
} from "@/lib/widget-client";

/**
 * The owner's OWN assistant widget, running in their dashboard (SPEC §8.7).
 *
 * Not a preview or a mockup: this is the exact script a customer pastes into their own
 * site, loaded from the same `/api/widget/embed.js` and talking to the same chat route —
 * so "see what your readers get" needs no second implementation to drift out of step, the
 * way the marketing home's demo (`AskDemo`) already works.
 *
 * Two things make the dashboard a slightly special host page:
 *
 * 1. **The app host is in nobody's allowlist.** The chat route authorizes this caller by
 *    dashboard session instead (`classifyWidgetCaller` → `sessionIsOrgMember`). That also
 *    means it works on localhost, unlike the marketing surfaces, whose origins have to be
 *    allowlisted for real.
 * 2. **It shares the corner with dashboard chrome** (sonner toasts, dialogs), so it mounts
 *    below them (`zIndex`) rather than at the loader's default near-max — on a customer's
 *    own page the widget should win that fight, in our dashboard it shouldn't.
 *
 * Which site it answers from follows the rail's own choice — `pickCurrentSite` over the
 * URL — so the bubble is always the site whose dashboard you're looking at. Gated on the
 * site's own `widgetEnabled`: the switch on Settings → Widget turns this on too, which is
 * the point (flip it, and the thing you just enabled is right there to try).
 */
export function SiteAssistantWidget({
  sites,
}: {
  sites: readonly { slug: string; name: string; widgetId: string | null; widgetEnabled: boolean }[];
}) {
  const pathname = usePathname();
  const current = pickCurrentSite(sites, parseSitePath(pathname).siteSlug);
  // One dependency, so switching sites (or toggling availability) re-runs the effect and
  // nothing else does: a route change within the same site must not remount the widget and
  // throw away an open conversation.
  const widgetId = current?.widgetEnabled ? current.widgetId : null;
  const siteName = current?.name ?? "";

  useEffect(() => {
    if (!widgetId) return;
    // Survives the effect being torn down before the async mount lands — React's dev
    // StrictMode double-invoke, and a fast site switch, both do exactly that.
    let live = true;

    loadPapervineWidget()
      .then((api) => {
        if (!live) return;
        return api.init({
          id: widgetId,
          theme: platformWidgetTheme(),
          title: siteName ? `Ask the ${siteName} assistant` : undefined,
          // A labelled pill rather than a bare bubble: in the dashboard the corner is ours to
          // explain, and it matches the docs site's own header button. Also the launcher's
          // accessible name (the embed script uses `trigger` for both).
          trigger: "Ask Assistant",
          // Below the dashboard's own overlays (dialogs, toasts) — see the note above.
          zIndex: 30,
        });
      })
      .catch(() => {
        // The widget is an extra in here: a failed load leaves the dashboard untouched, and
        // Settings → Widget still explains and installs it. Swallowed rather than logged
        // because the editor's e2e asserts a clean console.
      });

    const stopWatching = watchPlatformTheme((theme) => {
      window.PapervineAssistant?.update({ theme });
    });

    return () => {
      live = false;
      stopWatching();
      // The loader is a singleton keyed on nothing — one instance per document — so leaving
      // a mounted widget behind would make the NEXT site's init() resolve to the previous
      // site's bubble, silently answering from the wrong docs.
      window.PapervineAssistant?.destroy();
    };
  }, [widgetId, siteName]);

  return null;
}
