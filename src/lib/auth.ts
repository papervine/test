import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { db } from "./db";
import * as schema from "./db/schema";

// Better Auth rejects any request whose Origin isn't trusted (CSRF protection →
// "Invalid origin"). The control plane (signup/login/dashboard) serves on the apex
// `papervine.io`; reserved + tenant hosts live on `*.papervine.io`. The wildcard
// matches subdomains only, so the apex needs its own entry. BETTER_AUTH_URL adds
// this deploy's own origin too — covering local dev and Vercel preview URLs.
const trustedOrigins = [
  "https://papervine.io",
  "https://*.papervine.io",
  ...(process.env.BETTER_AUTH_URL ? [process.env.BETTER_AUTH_URL] : []),
];

// Layer 1 — platform auth (SPEC §10.1). Email/password first; the organization
// plugin gives us tenants/teams/roles. nextCookies() must be last so cookies set
// during server actions are forwarded correctly.
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: { enabled: true },
  trustedOrigins,
  plugins: [organization(), nextCookies()],
});
