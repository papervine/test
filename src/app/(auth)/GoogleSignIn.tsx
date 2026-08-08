"use client";

import { useState } from "react";
import { signIn } from "@/lib/auth-client";
import { Button } from "@/components/platform/Button";
import { postAuthDest } from "./post-auth-dest";

// Google's brand mark. Inline (not an <img>) so it needs no network fetch and inherits
// nothing from the platform palette — Google's terms require the official colors on both
// light and dark backgrounds. `size-4` comes from the Button's `[&_svg]` rule.
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

/**
 * "Continue with Google" — rendered by the login and signup pages only when the server
 * found Google credentials configured (src/lib/social-auth.ts).
 *
 * Both callback URLs are absolute on the CURRENT origin. Better Auth hands them straight to
 * the browser as a `Location`, and the OAuth callback is received on the apex before being
 * forwarded to the app host (see the middleware) — so a bare path would resolve against
 * whichever host happened to answer, landing the user on the marketing apex instead of the
 * dashboard. Same class of bug as the tenant-host redirect gotcha in CLAUDE.md.
 */
export function GoogleSignIn({ label }: { label: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setPending(true);
    setError(null);
    const origin = window.location.origin;
    const { error } = await signIn.social({
      provider: "google",
      callbackURL: new URL(postAuthDest(), origin).toString(),
      // Failures come back to the page the user started on, with `?error=<code>` — which
      // the form turns into a readable message (oauthErrorMessage).
      errorCallbackURL: new URL(window.location.pathname, origin).toString(),
    });
    // Success navigates away to Google, so reaching here at all means the request failed.
    if (error) {
      setPending(false);
      setError(error.message ?? "Couldn't start Google sign-in");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-[rgba(var(--ink-rgb),0.1)]" />
        <span className="text-xs uppercase tracking-wide text-[var(--muted)]">or</span>
        <span className="h-px flex-1 bg-[rgba(var(--ink-rgb),0.1)]" />
      </div>
      <Button
        type="button"
        variant="ghost"
        full
        disabled={pending}
        onClick={onClick}
      >
        <GoogleMark />
        {pending ? "Redirecting…" : label}
      </Button>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
