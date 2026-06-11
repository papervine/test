// A *benign* boolean cookie set on the parent domain (e.g. .papervine.io) when a user is
// logged in on the app host, so the marketing apex can show a "Dashboard" link without the
// real session token ever leaving the app host (SPEC §10). It carries no session data —
// just "1" — so its broader scope (it reaches tenant subdomains too) exposes nothing. The
// app-host middleware sets it; the rail's sign-out clears it; the marketing nav reads it.
export const SIGNED_IN_FLAG = "pv_signed_in";
