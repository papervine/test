// After login/signup on the app host, honor a pending invitation: a `?invite=<id>` param sends
// the user to the accept page instead of the dashboard, and `?email=` prefills the form so they
// use the invited address. Read from `window` (client-only) so the auth pages don't need
// useSearchParams — which would force a Suspense boundary around the form. SPEC §10 invitations.

import { oauthErrorMessage } from "@/lib/social-auth";

export function invitedEmailFromUrl(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("email") ?? "";
}

/** Where to land after a successful sign-in/up: the accept page for a pending invite, else "/". */
export function postAuthDest(): string {
  if (typeof window === "undefined") return "/";
  const invite = new URLSearchParams(window.location.search).get("invite");
  return invite ? `/accept-invite?id=${encodeURIComponent(invite)}` : "/";
}

/**
 * A failed social sign-in comes back to this page as `?error=<code>` (Better Auth's
 * errorCallbackURL). Turn it into the sentence to show above the form, or null when the
 * page was reached normally. Read from `window` like the helpers above, for the same
 * reason — no useSearchParams, so no Suspense boundary around the form.
 */
export function oauthErrorFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  return oauthErrorMessage(new URLSearchParams(window.location.search).get("error"));
}
