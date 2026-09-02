import { test as setup, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { hashPassword } from "better-auth/crypto";
import { TEST_USER, ORG_SLUG } from "./constants";
import { TEST_DB_URL } from "./global-setup";

const authFile = "tests/e2e/.auth/user.json";

// Seed the user + org directly, then sign in. The rest of the suite loads the saved
// session (Playwright storageState) and starts authenticated. reset-db.mjs rebuilt the DB
// before the server booted, so every row here is fresh each run.
//
// This used to drive the real signup → onboarding → create-org → connect flow through the
// browser. That was FOUR cold `next dev` route compiles before a single spec could start —
// 1.3–1.5 minutes on CI, and since sharding it is paid once PER SHARD, on the critical path
// of every one. Seeding the same rows the signup flow would have written (user, credential
// account with a Better Auth password hash, organization, owner membership) and signing in
// touches one route instead of four.
//
// What this does NOT lose: real-signup coverage. That flow now has its own spec,
// signup.spec.ts, which runs on one shard with a different email. What it deliberately
// skips: the `afterCreateOrganization` hook — its only job is `startTrial`, which returns
// immediately without AUTUMN_SECRET_KEY, and CI has none. If that hook ever grows a second
// duty, seeding here has to grow to match; the comment in src/lib/auth.ts is the place to
// find out.
//
// The hash comes from the same `better-auth/crypto` the dev seed uses (scripts/seed-dev.mjs),
// which is the proof it is a hash Better Auth's sign-in accepts.
setup("authenticate", async ({ page }) => {
  // Sign-in cold-compiles /login and the post-login landing. On CI that alone can exceed the
  // 30s default; there is no reason for this to ever need more than a couple of minutes.
  setup.setTimeout(120_000);

  const sql = postgres(TEST_DB_URL, { max: 1 });
  try {
    const now = new Date();
    const userId = randomUUID();
    const orgId = randomUUID();
    await sql`insert into "user" (id, name, email, email_verified, created_at, updated_at)
              values (${userId}, ${TEST_USER.name}, ${TEST_USER.email}, true, ${now}, ${now})
              on conflict (email) do nothing`;
    // The seed is idempotent against a stray earlier row: re-read the id we actually own.
    const [u] = await sql`select id from "user" where email = ${TEST_USER.email}`;
    const hash = await hashPassword(TEST_USER.password);
    await sql`insert into account (id, account_id, provider_id, user_id, password, created_at, updated_at)
              values (${randomUUID()}, ${u.id}, 'credential', ${u.id}, ${hash}, ${now}, ${now})
              on conflict do nothing`;
    await sql`insert into organization (id, name, slug, created_at)
              values (${orgId}, ${TEST_USER.org}, ${ORG_SLUG}, ${now})
              on conflict (slug) do nothing`;
    const [o] = await sql`select id from organization where slug = ${ORG_SLUG}`;
    await sql`insert into member (id, organization_id, user_id, role, created_at)
              values (${randomUUID()}, ${o.id}, ${u.id}, 'owner', ${now})
              on conflict do nothing`;
  } finally {
    await sql.end();
  }

  await page.goto("/login");
  await page.getByLabel("Email").fill(TEST_USER.email);
  await page.getByLabel("Password").fill(TEST_USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  // Org but no site yet → the resolver lands on the add-site chooser at /:org/connect, which
  // shows its first-run framing for a site-less org (SPEC §10.11). Same landing the signup
  // flow reaches, so specs that depend on that state see exactly what they saw before.
  await page.waitForURL(`**/${ORG_SLUG}/connect`, { timeout: 90_000 });
  await expect(
    page.getByRole("heading", { name: "Create your first site" }),
  ).toBeVisible();

  await page.context().storageState({ path: authFile });
});
