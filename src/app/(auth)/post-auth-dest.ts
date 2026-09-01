// After login/signup on the app host, honor a pending invitation: a `?invite=<id>` param sends
// the user to the accept page instead of the dashboard, and `?email=` prefills the form so they
// use the invited address. Read from `window` (client-only) so the auth pages don't need
// useSearchParams — which would force a Suspense boundary around the form. SPEC §10 invitations.

import { oauthErrorMessage } from "@/lib/social-auth";
import { safeRedirect } from "@/lib/safe-redirect";

export function invitedEmailFromUrl(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("email") ?? "";
}

/**
 * Where to land after a successful sign-in/up, given the auth page's own query string.
 *
 * Pure so it can be unit-tested without a browser; `postAuthDest()` supplies `window`'s search
 * for the two call sites. Order matters, most-specific first: a flow the user is already *inside*
 * beats every other destination, because dropping them on the dashboard strands whatever sent
 * them, with no way back but starting over.
 */
export function postAuthDestFor(search: string): string {
  const params = new URLSearchParams(search);

  // Resuming an OAuth authorization (SPEC §9.2/§11.4 — the authoring MCP). Better Auth's `mcp`
  // plugin sends an unauthenticated `/api/auth/mcp/authorize` here with the whole authorize
  // query appended, and expects the app to come back once there's a session. `client_id` +
  // `response_type` together are what identify that round trip; neither appears on this page
  // otherwise.
  if (params.get("client_id") && params.get("response_type")) {
    // Relative, so it resolves against whichever host the user is on. An absolute URL built
    // from configuration is what sent dev users from :3001 to a different server on :3000.
    return `/api/auth/mcp/authorize?${search.replace(/^\?/, "")}`;
  }

  // An explicit `?redirect=`: approving a device authorization from `papervine login`
  // (SPEC §11.4), or resuming a GitHub App install. Same-host paths only — `safeRedirect`
  // refuses anything that could leave this origin, because forwarding a freshly authenticated
  // visitor to an arbitrary URL from a login page is the textbook open redirect.
  //
  // This parameter was being *emitted* long before anything read it: `/api/github/setup` has
  // bounced unauthenticated installs to `/login?redirect=…` since §10, and that resume always
  // landed on the dashboard instead.
  const redirect = safeRedirect(params.get("redirect"));
  if (redirect) return redirect;

  const invite = params.get("invite");
  return invite ? `/accept-invite?id=${encodeURIComponent(invite)}` : "/";
}

/** Where to land after a successful sign-in/up: the accept page for a pending invite, else "/". */
export function postAuthDest(): string {
  if (typeof window === "undefined") return "/";
  return postAuthDestFor(window.location.search);
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
