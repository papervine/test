"use client";

import { useEffect } from "react";

/**
 * TEMPORARY: our own assistant widget in the corner, in place of the Chatwoot inbox.
 *
 * Dogfooding the thing we sell as our support channel. To put Chatwoot back, swap the two
 * components in `src/app/layout.tsx` — both are still mounted side by side there, and neither
 * knows about the other.
 *
 * Same tenant boundary as everything else in that block: the root layout renders tenant docs
 * too, and OUR support widget on a customer's site would invite their readers to ask us about a
 * product they've never heard of — and collide with the tenant's own assistant launcher in that
 * corner (SPEC §8.6).
 *
 * The `data-widget-id` single-tag install auto-initializes (widget-embed-script.ts), so there's
 * nothing to call: injecting the tag is the whole integration. That's the same snippet a
 * customer pastes, which is the point of using it here.
 */

/** The site this widget answers from. Hardcoded because this is a temporary swap. */
const WIDGET_ID = "widget_04ef6454-a15a-4b6f-9c01-da91490dd642";

/**
 * Absolute, and pointing at the app host on purpose: the script sets its API base from its own
 * URL (`new URL(import.meta.url).origin`), so a relative src would make the marketing apex talk
 * to itself and the app host talk to itself — two different origins to keep allowlisted for one
 * widget. One origin, allowlisted once.
 */
const LOADER = "https://app.papervine.io/api/widget/embed.js";

const SCRIPT_ID = "papervine-support-widget";

export function SupportWidget() {
  useEffect(() => {
    // Guard on the id rather than a module flag: a client-side navigation remounts this, and the
    // loader auto-initializes on parse — a second tag would race the first for the singleton.
    if (document.getElementById(SCRIPT_ID)) return;

    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.type = "module";
    script.src = LOADER;
    script.dataset.widgetId = WIDGET_ID;
    document.head.appendChild(script);

    // No cleanup: like Chatwoot before it, this is a singleton for the page load, and tearing it
    // down on a route change would drop a conversation someone is in the middle of.
  }, []);

  return null;
}
