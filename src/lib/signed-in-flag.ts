// A *benign* boolean cookie set on the parent domain (e.g. .papervine.io) when a user is
// logged in on the app host, so the marketing apex can show a "Dashboard" link without the
// real session token ever leaving the app host (SPEC §10). It carries no session data —
// just "1". Being a parent-domain cookie it DOES reach tenant subdomains, so it's set
// httpOnly (+ Secure in prod): tenant page JS can never read it, only our own servers see
// it. The app-host middleware both sets it (when authed) and clears it (on logout, seeing
// no session cookie); the marketing nav reads it server-side.
export const SIGNED_IN_FLAG = "pv_signed_in";
