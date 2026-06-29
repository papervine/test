import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { db } from "./db";
import * as schema from "./db/schema";

// Better Auth rejects any request whose Origin isn't trusted (CSRF protection →
// "Invalid origin"). The control plane (signup/login/dashboard) serves on the app host
// `app.papervine.io` (SPEC §10) — covered by the `*.papervine.io` wildcard; the apex
// entry stays for the marketing host. In dev the control plane is `app.localhost:3000`,
// which no wildcard above matches, so it needs its own entry. BETTER_AUTH_URL adds this
// deploy's own origin too — covering Vercel preview URLs.
const trustedOrigins = [
  "https://papervine.io",
  "https://*.papervine.io",
  "http://app.localhost:3000",
  ...(process.env.BETTER_AUTH_URL ? [process.env.BETTER_AUTH_URL] : []),
];

// Layer 1 — platform auth (SPEC §10.1). Email/password first; the organization
// plugin gives us tenants/teams/roles. nextCookies() must be last so cookies set
// during server actions are forwarded correctly.
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: { enabled: true },
  trustedOrigins,
  plugins: [
    organization({
      // Invitation delivery seam (SPEC §10). v1 has NO email infra — the Members settings
      // action surfaces a shareable accept link directly (Copy-link UI), so a real send isn't
      // required to invite. This callback just records the link server-side; it's the single
      // place a real provider (e.g. Resend) slots in later — send `acceptUrl` to `data.email`
      // with `data.inviter`/`data.organization` for the template. No throw → never blocks the
      // createInvitation the action awaits.
      sendInvitationEmail: async (data) => {
        const origin = process.env.BETTER_AUTH_URL ?? "https://app.papervine.io";
        const acceptUrl = `${origin}/accept-invite?id=${data.id}`;
        console.log(
          `[invite] ${data.email} → ${data.organization.name} (${data.role}) — ${acceptUrl}`,
        );
      },
    }),
    nextCookies(),
  ],
});
