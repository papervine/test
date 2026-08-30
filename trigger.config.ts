import { defineConfig } from "@trigger.dev/sdk/v3";
import { esbuildPlugin } from "@trigger.dev/build/extensions";
import { syncVercelEnvVars } from "@trigger.dev/build/extensions/core";

// The executor runs in Trigger.dev's cloud, NOT on Vercel — it does not inherit the web
// app's environment. Its tasks import the full authoring/billing/db/renderer stack, which
// reads DATABASE_URL, the S3 draft-buffer creds, the AI route, and the GitHub App keys; a
// missing/stale one fails a run on its first DB query (the "Failed query … automation_run"
// symptom, SPEC §10.2). syncVercelEnvVars mirrors the Vercel project's env into the matching
// Trigger environment at DEPLOY time (prod→production), so the two never drift. Gated on the
// deploy shell providing Vercel API creds — CI's deploy-trigger job sets them from secrets;
// a local `trigger.dev deploy` without them simply skips the sync (and `trigger.dev dev` is
// never affected: the extension self-skips the dev target). Best-effort by design: an
// expired token warns and deploys unsynced rather than failing the deploy.
const vercelEnvSync =
  process.env.VERCEL_ACCESS_TOKEN && process.env.VERCEL_PROJECT_ID ? [syncVercelEnvVars()] : [];

export default defineConfig({
  // The hosted project by default; `TRIGGER_PROJECT_REF` points this at a self-hosted stack
  // (scripts/trigger-local.mjs). A self-hosted webapp mints its own refs, so without this the
  // CLI would register local tasks against a project that only exists in the cloud.
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_rjriwuagrstnzwseaytk",
  runtime: "node",
  logLevel: "log",
  // The max compute seconds a task is allowed to run. If the task run exceeds this duration, it will be stopped.
  // You can override this on an individual task.
  // See https://trigger.dev/docs/runs/max-duration
  maxDuration: 3600,
  // Agent runs must not silently replay: a failed run is a visible failed run in the
  // run history (SPEC §10.2). Idempotent tasks opt back in per-task.
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 1,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
  dirs: ["./src/trigger"],
  build: {
    // @vercel/oidc must load from real files, not the bundle: getVercelOidcToken()
    // dynamic-imports sibling modules by relative path ("./token-util.js"), which
    // resolves on disk but not inside an esbuild bundle — bundled, every gateway call
    // dies as GatewayAuthenticationError even with a valid VERCEL_OIDC_TOKEN.
    external: ["@vercel/oidc"],
    extensions: [
      // The tasks reuse the app's authoring/billing stack, which is written for the
      // Next server runtime. Two imports in that closure are Next-only and need
      // stubbing for plain Node:
      // - `server-only`: a build-time poison pill (its default export condition just
      //   throws). Outside Next the guard is meaningless — stub to an empty module.
      // - `next/cache`: unstable_cache/revalidate* only exist inside the Next server.
      //   In a task, caching is identity and revalidation is a no-op — the app's own
      //   caches revalidate when the resulting commit syncs back via the webhook.
      esbuildPlugin(
        {
          name: "next-runtime-stubs",
          setup(build) {
            build.onResolve({ filter: /^server-only$/ }, (args) => ({
              path: args.path,
              namespace: "next-runtime-stubs",
            }));
            build.onResolve({ filter: /^next\/cache$/ }, () => ({
              path: "next/cache",
              namespace: "next-runtime-stubs",
            }));
            build.onLoad({ filter: /.*/, namespace: "next-runtime-stubs" }, (args) =>
              args.path === "next/cache"
                ? {
                    contents:
                      "export const unstable_cache = (fn) => fn;\n" +
                      "export const revalidateTag = () => {};\n" +
                      "export const revalidatePath = () => {};\n",
                    loader: "js",
                  }
                : { contents: "export {};", loader: "js" },
            );
          },
        },
        { placement: "first" },
      ),
      // Keep the executor's env in lockstep with Vercel's (see vercelEnvSync above).
      ...vercelEnvSync,
    ],
  },
});
