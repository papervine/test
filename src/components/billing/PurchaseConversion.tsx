"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { PurchaseConversion as Payload } from "@/lib/billing/conversion";

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

/**
 * Report a completed purchase to Google Ads, once, when Stripe sends the customer back
 * (SPEC §10 Billing). Renders nothing.
 *
 * A client component and not the snippet Google hands you: a literal `<script>` written into
 * a React tree is never executed — React logs "Encountered a script tag while rendering React
 * component" and moves on — so pasting it would look installed and measure nothing. Same trap
 * `GoogleAdsTag` documents; this is the other half of it.
 *
 * The payload is computed on the server (`purchaseConversion`) so prices come from Autumn
 * rather than the browser, and it is null unless a real, priced purchase just happened — which
 * is why this can be mounted unconditionally on the billing page.
 *
 * Two things keep a refresh from counting twice: Google dedupes on `transaction_id`, and the
 * `checkout` params are stripped from the URL as soon as the event is sent, so a bookmark or a
 * back button lands on a plain billing page.
 */
export function PurchaseConversion({ payload }: { payload: Payload | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const sent = useRef(false);

  useEffect(() => {
    if (!payload || sent.current) return;
    sent.current = true;
    // QUEUE the command; do not call `window.gtag`. The tag is loaded through next/script's
    // afterInteractive strategy, so on the one navigation that matters — the return from
    // Stripe — this effect runs BEFORE gtag.js has executed and `window.gtag` is undefined.
    // An optional call there looks correct, logs nothing, and drops the purchase on the floor;
    // caught only by watching dataLayer in a browser. Every gtag command IS a dataLayer entry,
    // and gtag.js drains whatever it finds when it arrives, so pushing the command directly
    // works whether the tag has loaded, is about to, or never will (self-host, blocker).
    // `arguments` rather than an array literal, because that is the shape Google's own shim
    // pushes and the one gtag.js is documented to read.
    window.dataLayer = window.dataLayer ?? [];
    const queue = function (this: void) {
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer?.push(arguments);
    } as (...args: unknown[]) => void;
    queue("event", "conversion", {
      send_to: payload.sendTo,
      value: payload.value,
      currency: payload.currency,
      transaction_id: payload.transactionId,
    });
    router.replace(pathname);
  }, [payload, pathname, router]);

  return null;
}
