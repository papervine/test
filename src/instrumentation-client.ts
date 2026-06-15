// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://96dc558da051cb3d6548fed0494da935@o4504170566320128.ingest.us.sentry.io/4511570839535616",

  // Add optional integrations for additional features.
  // Replays are UNMASKED: by default Replay masks all text and blocks all media, which is why
  // the PAPERVINE-4 black-screen replay showed only "••••••" and was hard to debug (SPEC §10.7).
  // We turn masking off so replays are legible for triage. Tradeoff: this config is global to
  // the whole app, so replays on public tenant docs capture reader content too — paired with
  // `sendDefaultPii: true` below. Revisit if we want to scope unmasking to the app host only.
  integrations: [
    Sentry.replayIntegration({ maskAllText: false, blockAllMedia: false }),
  ],

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate: 1,
  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Define how likely Replay events are sampled.
  // This sets the sample rate to be 10%. You may want this to be 100% while
  // in development and sample at a lower rate in production
  replaysSessionSampleRate: 0.1,

  // Define how likely Replay events are sampled when an error occurs.
  replaysOnErrorSampleRate: 1.0,

  // Enable sending user PII (Personally Identifiable Information)
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  sendDefaultPii: true,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
