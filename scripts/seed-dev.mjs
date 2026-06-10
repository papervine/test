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
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const DEV = {
  user: { name: "Dev User", email: "dev@papervine.local", password: "dev-password-123" },
  org: { name: "Dev Org", slug: "dev-org" },
  // Both repos are synced into our object storage on seed (just like a real connect), so
  // the render path reads only from us — config, pages, AND assets (logos/images). `starter`
  // is the tiny canonical template; `large-docs` is a large real repo, good for exercising
  // the renderer/nav at scale. The first site is the "primary" (gets analytics seeded).
  sites: [
    { name: "Starter Docs", slug: "starter", repoOwner: "papervine", repoName: "starter", branch: "main" },
    { name: "Incumbent Docs", slug: "large-docs", repoOwner: "papervine", repoName: "docs", branch: "main" },
  ],
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

// Object storage client (MinIO locally) — same env as src/lib/storage.ts. The seed runs
// under plain `node`, so it can't import the TS sync module; this mirrors src/lib/sync.ts
// (keep the two in step). We copy the repo into sites/{id}/… exactly as a real connect does,
// so isSynced() is true and the render path reads everything — config, pages, assets — from us.
const s3 = new S3Client({
  region: process.env.S3_REGION ?? "auto",
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
  },
});
const S3_BUCKET = process.env.S3_BUCKET ?? "papervine-content";
const TEXT_EXT = /\.(mdx?|json|ya?ml)$/i;
const ASSET_EXT = /\.(png|jpe?g|gif|svg|webp|avif|ico|bmp|mp4|webm|pdf|woff2?)$/i;

/** Copy a repo's docs (config + MDX + assets) into sites/{id}/… (mirrors syncSite). */
async function syncToStorage({ id, repoOwner, repoName, branch }) {
  const ghHeaders = { accept: "application/vnd.github+json", "user-agent": "papervine" };
  if (process.env.GITHUB_TOKEN) ghHeaders.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  const treeRes = await fetch(
    `https://api.github.com/repos/${repoOwner}/${repoName}/git/trees/${branch}?recursive=1`,
    { headers: ghHeaders },
  );
  if (!treeRes.ok) throw new Error(`tree ${repoOwner}/${repoName}@${branch} → HTTP ${treeRes.status}`);
  const tree = (await treeRes.json()).tree ?? [];
  const files = tree.filter(
    (t) => t.type === "blob" && (TEXT_EXT.test(t.path) || ASSET_EXT.test(t.path)),
  );

  const rawBase = `https://raw.githubusercontent.com/${repoOwner}/${repoName}/${branch}`;
  let count = 0;
  for (const f of files) {
    const res = await fetch(`${rawBase}/${f.path}`);
    if (!res.ok) continue;
    const isAsset = ASSET_EXT.test(f.path);
    await s3.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: `sites/${id}/${f.path}`,
        Body: isAsset ? new Uint8Array(await res.arrayBuffer()) : await res.text(),
        ContentType: isAsset
          ? (res.headers.get("content-type") ?? undefined)
          : "text/plain; charset=utf-8",
      }),
    );
    count++;
  }
  return count;
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

// 3 + 4. Connected sites + their activity feeds. Each repo is synced into object storage
//        (below) so the render path reads only from us. The feed (a couple of successful
//        syncs + one failed) exercises the feed UI's "Why it failed" disclosure;
//        cleared+rebuilt so re-runs don't pile up.
const mins = (m) => new Date(now.getTime() - m * 60_000);
const feed = [
  { status: "successful", target: "live", msg: "docs: expand quickstart with prerequisites", added: 1, edited: 3, at: mins(12), err: null },
  { status: "successful", target: "live", msg: "feat: add API reference section", added: 6, edited: 1, at: mins(180), err: null },
  {
    status: "failed",
    target: "live",
    msg: "chore: bump deps",
    added: 0,
    edited: 0,
    at: mins(300),
    err: "docs.json: Unexpected token } in JSON at position 412\n  at JSON.parse (<anonymous>)",
  },
  // Per-branch preview builds — the Overview Activity feed's Previews tab (SPEC §10.3).
  { status: "successful", target: "preview", msg: "preview: draft new onboarding flow (branch: onboarding-v2)", added: 4, edited: 2, at: mins(45), err: null },
  { status: "successful", target: "preview", msg: "preview: restructure guides nav (branch: nav-cleanup)", added: 0, edited: 7, at: mins(220), err: null },
];

for (const s of DEV.sites) {
  let siteId = await findId("site", "slug", s.slug);
  if (siteId) {
    await sql`update site set organization_id = ${orgId}, name = ${s.name},
              repo_owner = ${s.repoOwner}, repo_name = ${s.repoName},
              branch = ${s.branch}, status = 'live', updated_at = ${now} where id = ${siteId}`;
    console.log(`• site ${s.slug} exists — updated`);
  } else {
    siteId = randomUUID();
    await sql`insert into site (id, organization_id, name, slug, repo_owner, repo_name, branch, status, created_at, updated_at)
              values (${siteId}, ${orgId}, ${s.name}, ${s.slug}, ${s.repoOwner},
                      ${s.repoName}, ${s.branch}, 'live', ${now}, ${now})`;
    console.log(`• created site ${s.slug} → ${s.repoOwner}/${s.repoName}`);
  }

  // Sync the repo into our object storage so the render path serves config, pages, AND
  // assets (logos/images) from us — never GitHub at request time.
  try {
    const files = await syncToStorage({
      id: siteId,
      repoOwner: s.repoOwner,
      repoName: s.repoName,
      branch: s.branch,
    });
    console.log(`  ↳ synced ${files} files into object storage`);
  } catch (e) {
    console.warn(`  ↳ sync failed for ${s.slug}: ${e.message} — docs won't render until re-synced`);
  }

  await sql`delete from deployment where site_id = ${siteId}`;
  for (const d of feed) {
    await sql`insert into deployment (id, site_id, status, target, commit_sha, commit_message, error, files_added, files_edited, actor_user_id, created_at)
              values (${randomUUID()}, ${siteId}, ${d.status}, ${d.target}, ${randomUUID().slice(0, 7)}, ${d.msg},
                      ${d.err}, ${d.added}, ${d.edited}, ${userId}, ${d.at})`;
  }
}
console.log(`• seeded ${DEV.sites.length} sites + ${feed.length} activity rows each`);

await sql.end();

// 5. Analytics page data — reuse the existing seeder against the primary site.
const primary = DEV.sites[0];
try {
  execFileSync("node", ["--env-file=.env.local", "scripts/seed-analytics.mjs", primary.slug], {
    stdio: "inherit",
  });
} catch {
  console.warn("• analytics seed skipped (seed-analytics.mjs failed — non-fatal)");
}

console.log(
  `\n✓ Seed complete. Log in at /login:\n` +
    `    email:    ${DEV.user.email}\n` +
    `    password: ${DEV.user.password}\n` +
    `  Live docs (path form on a no-domain host):\n` +
    DEV.sites.map((s) => `    /sites/${s.slug}  (${s.repoOwner}/${s.repoName})`).join("\n"),
);
