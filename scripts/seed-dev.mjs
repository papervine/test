// Seed a known account + a connected site for local dev / agent testing. One command
// gets you a loggable dashboard with data, instead of hand-walking signup → onboarding
// → connect every time. Pure DB ops (mirrors scripts/seed-analytics.mjs and
// tests/e2e/global-setup.ts) — the password is hashed with Better Auth's own hasher so
// the credential account logs in through the real flow. Run:
//   npm run db:seed
//
// Idempotent: upserts by email / org slug / site slug, and rebuilds the activity feed.
// PROD-GUARDED: refuses any non-local DATABASE_URL — a known password must never reach a
// real database. After seeding, log in at /login with the printed credentials.
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { hashPassword } from "better-auth/crypto";

const DEV = {
  user: { name: "Dev User", email: "dev@docbot.local", password: "dev-password-123" },
  org: { name: "Dev Org", slug: "dev-org" },
  site: { name: "Starter Docs", slug: "starter", repoOwner: "papervine", repoName: "starter", branch: "main" },
};

const DATABASE_URL = process.env.DATABASE_URL ?? "";

// Hard prod guard: only ever seed a local database. A known-password account on a real
// host would be a standing security hole, so refuse anything but localhost/127.0.0.1.
const host = (() => {
  try {
    return new URL(DATABASE_URL).hostname;
  } catch {
    return "";
  }
})();
if (!["localhost", "127.0.0.1"].includes(host)) {
  console.error(
    `✗ Refusing to seed: DATABASE_URL host is "${host || "(unparseable)"}", not localhost.\n` +
      `  This script creates a known-password account and must only run against a local dev DB.`,
  );
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 1 });
const now = new Date();

/** Upsert helper: return the existing row's id by a unique column, or null. */
async function findId(table, column, value) {
  const rows = await sql`select id from ${sql(table)} where ${sql(column)} = ${value} limit 1`;
  return rows[0]?.id ?? null;
}

// 1. User + credential account (Better Auth's `account` row holds the password hash).
let userId = await findId("user", "email", DEV.user.email);
const passwordHash = await hashPassword(DEV.user.password);
if (userId) {
  await sql`update account set password = ${passwordHash}, updated_at = ${now}
            where user_id = ${userId} and provider_id = 'credential'`;
  console.log(`• user ${DEV.user.email} exists — refreshed password`);
} else {
  userId = randomUUID();
  await sql`insert into "user" (id, name, email, email_verified, created_at, updated_at)
            values (${userId}, ${DEV.user.name}, ${DEV.user.email}, true, ${now}, ${now})`;
  await sql`insert into account (id, account_id, provider_id, user_id, password, created_at, updated_at)
            values (${randomUUID()}, ${userId}, 'credential', ${userId}, ${passwordHash}, ${now}, ${now})`;
  console.log(`• created user ${DEV.user.email}`);
}

// 2. Organization + owner membership (the dashboard lists orgs by membership).
let orgId = await findId("organization", "slug", DEV.org.slug);
if (!orgId) {
  orgId = randomUUID();
  await sql`insert into organization (id, name, slug, created_at)
            values (${orgId}, ${DEV.org.name}, ${DEV.org.slug}, ${now})`;
  console.log(`• created org ${DEV.org.slug}`);
}
const member = await sql`select id from member where organization_id = ${orgId} and user_id = ${userId} limit 1`;
if (!member[0]) {
  await sql`insert into member (id, organization_id, user_id, role, created_at)
            values (${randomUUID()}, ${orgId}, ${userId}, 'owner', ${now})`;
  console.log(`• added owner membership`);
}

// 3. Connected site (public repo → renders via the live-GitHub fallback, no sync needed).
let siteId = await findId("site", "slug", DEV.site.slug);
if (siteId) {
  await sql`update site set organization_id = ${orgId}, name = ${DEV.site.name},
            repo_owner = ${DEV.site.repoOwner}, repo_name = ${DEV.site.repoName},
            branch = ${DEV.site.branch}, status = 'live', updated_at = ${now} where id = ${siteId}`;
  console.log(`• site ${DEV.site.slug} exists — updated`);
} else {
  siteId = randomUUID();
  await sql`insert into site (id, organization_id, name, slug, repo_owner, repo_name, branch, status, created_at, updated_at)
            values (${siteId}, ${orgId}, ${DEV.site.name}, ${DEV.site.slug}, ${DEV.site.repoOwner},
                    ${DEV.site.repoName}, ${DEV.site.branch}, 'live', ${now}, ${now})`;
  console.log(`• created site ${DEV.site.slug} → ${DEV.site.repoOwner}/${DEV.site.repoName}`);
}

// 4. Activity feed — a couple of successful syncs + one failed, to exercise the feed UI
//    (including the "Why it failed" disclosure). Cleared+rebuilt so re-runs don't pile up.
await sql`delete from deployment where site_id = ${siteId}`;
const mins = (m) => new Date(now.getTime() - m * 60_000);
const feed = [
  { status: "successful", msg: "docs: expand quickstart with prerequisites", added: 1, edited: 3, at: mins(12), err: null },
  { status: "successful", msg: "feat: add API reference section", added: 6, edited: 1, at: mins(180), err: null },
  {
    status: "failed",
    msg: "chore: bump deps",
    added: 0,
    edited: 0,
    at: mins(300),
    err: "docs.json: Unexpected token } in JSON at position 412\n  at JSON.parse (<anonymous>)",
  },
];
for (const d of feed) {
  await sql`insert into deployment (id, site_id, status, target, commit_sha, commit_message, error, files_added, files_edited, actor_user_id, created_at)
            values (${randomUUID()}, ${siteId}, ${d.status}, 'live', ${randomUUID().slice(0, 7)}, ${d.msg},
                    ${d.err}, ${d.added}, ${d.edited}, ${userId}, ${d.at})`;
}
console.log(`• seeded ${feed.length} activity rows`);

await sql.end();

// 5. Analytics page data — reuse the existing seeder against this site.
try {
  execFileSync("node", ["--env-file=.env.local", "scripts/seed-analytics.mjs", DEV.site.slug], {
    stdio: "inherit",
  });
} catch {
  console.warn("• analytics seed skipped (seed-analytics.mjs failed — non-fatal)");
}

console.log(
  `\n✓ Seed complete. Log in at /login:\n` +
    `    email:    ${DEV.user.email}\n` +
    `    password: ${DEV.user.password}\n` +
    `  Live docs (path form on a no-domain host): /sites/${DEV.site.slug}`,
);
