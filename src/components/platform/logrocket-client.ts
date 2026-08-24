"use client";

// One LogRocket instance per page load, shared by every mount point.
//
// LogRocket is initialised in the ROOT layout (so it covers marketing, the auth pages,
// onboarding, /admin and the dashboard) but `identify` can only run where there's a session —
// the dashboard layout. Those are a parent and a descendant, and React runs a child's effects
// BEFORE its parent's, so the identify call would otherwise fire before init.
//
// Hence a module-level promise: whoever gets there first performs the init, everyone else awaits
// the same one. `import("logrocket")` is a browser-only bundle, so it's dynamic — that also keeps
// it out of the initial chunk.
// `logrocket` is CommonJS (`export = LogRocket`), so its TYPE is the object itself while the ESM
// interop hands a dynamic import a `{ default }` wrapper. Accept either shape rather than
// asserting one and being wrong depending on how it gets bundled.
type LogRocketModule = typeof import("logrocket");

let pending: Promise<LogRocketModule | null> | null = null;

export function ensureLogRocket(appId: string | undefined): Promise<LogRocketModule | null> {
  if (!appId) return Promise.resolve(null);
  pending ??= import("logrocket").then((mod) => {
    const LogRocket =
      (mod as unknown as { default?: LogRocketModule }).default ?? (mod as LogRocketModule);
    LogRocket.init(appId, {
      // Forced ON. Session replay records input VALUES by default, and this app's forms hold
      // real credentials — the GitHub token on Git settings, widget keys, the reader-auth JWT
      // secret, and every password field on the auth pages that this now also covers. Masking
      // is the only safe posture; loosen it per field only with a reason.
      dom: { inputSanitizer: true },
    });
    return LogRocket;
  });
  return pending;
}
