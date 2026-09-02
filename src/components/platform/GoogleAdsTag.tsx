import Script from "next/script";

/**
 * Google Ads conversion tag (gtag.js) — OUR acquisition measurement, on our own surfaces only.
 *
 * Loaded through `next/script` rather than the raw snippet Google hands you. A literal `<script>`
 * inside a React component is not executed on the client — React logs "Encountered a script tag
 * while rendering React component" and moves on — so pasting the snippet as-is would have looked
 * installed and measured nothing.
 *
 * Same tenant boundary as `<Analytics/>`, LogRocket and Chatwoot, and here it is the sharpest of
 * the four: this is an **advertising** tag. On a customer's docs site it would load Google Ads on
 * pages we don't own, attach a third-party advertising cookie to *their* readers, and route that
 * signal to *our* ad account — a consent and data-protection problem for them, created by us. The
 * root layout mounts it under `!isTenant`, which is the apex plus the app host: marketing, auth,
 * onboarding, the dashboard.
 *
 * The id comes from the environment, and that is not ceremony. A hardcoded `AW-…` would mean every
 * self-hoster and every fork reporting conversions into our Google Ads account — the same mistake
 * as a shared LogRocket app-id or Chatwoot token, and the same shape as the Sentry DSN that once
 * got compiled into the public CLI tarball (SPEC §10.6). Absent → renders nothing, which is also
 * what keeps local dev and preview deployments out of the account.
 */
export function GoogleAdsTag({ conversionId }: { conversionId: string | undefined }) {
  if (!conversionId) return null;

  return (
    <>
      <Script
        id="google-ads-gtag"
        src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(conversionId)}`}
        strategy="afterInteractive"
      />
      {/* `dataLayer.push(arguments)` verbatim from Google: gtag relies on the `arguments` object,
          so this cannot become a rest parameter without changing what gets queued. */}
      <Script id="google-ads-config" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', ${JSON.stringify(conversionId)});`}
      </Script>
    </>
  );
}
