// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://96dc558da051cb3d6548fed0494da935@o4504170566320128.ingest.us.sentry.io/4511570839535616",

  // Only report from real deployments — see instrumentation-client.ts for why (local
  // dev was polluting the prod project: PAPERVINE-5/6/7/8). Vercel prod + preview both
  // run NODE_ENV=production and still report, tagged by environment.
  // …and never from the e2e suite, which is a production build (see src/lib/env.ts).
  enabled:
    process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_PAPERVINE_TEST_MODE !== "1",

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate: 1,

  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Enable sending user PII (Personally Identifiable Information)
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  sendDefaultPii: true,
});
