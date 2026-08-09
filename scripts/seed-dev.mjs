// Seed two known accounts + a connected site for local dev / agent testing. One command
// gets you a loggable dashboard with data, instead of hand-walking signup → onboarding
// → connect every time — and two members of the same org so you can log in as both (two
// browser profiles) to exercise real-time collab (SPEC §9.2). Pure DB ops (mirrors
// scripts/seed-analytics.mjs and tests/e2e/global-setup.ts) — passwords are hashed with
// Better Auth's own hasher so the credential accounts log in through the real flow. Run:
//   npm run db:seed
//
// Idempotent: upserts by email / org slug / site slug, and rebuilds the activity feed.
// PROD-GUARDED: refuses any non-local DATABASE_URL — a known password must never reach a
// real database. After seeding, log in at /login with the printed credentials.
import { randomUUID, generateKeyPairSync, createCipheriv, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import postgres from "postgres";

// Mirror src/lib/crypto.ts (AES-256-GCM, base64(iv|tag|ciphertext)) so the app can decrypt
// what we seed. Only used for a JWT site's private key — returns null if the key is unset.
function encryptSecret(plain) {
  const raw = process.env.PAPERVINE_ENCRYPTION_KEY;
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

// A per-site Ed25519 reader-auth keypair (SPEC §11.2): private (PKCS#8 PEM) encrypted into
// auth_secret_enc, public (SPKI PEM) into auth_config.publicKey — exactly what the dashboard
// generates, so the JWT handshake actually verifies. `scripts/sign-reader-jwt.mjs` reads the
// private key back out to mint test tokens.
function genReaderKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
  };
}
import { hashPassword } from "better-auth/crypto";
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { imageSize } from "image-size";

const DEV = {
  // Two members so you can log in as both (e.g. two browser profiles/private windows) and
  // exercise real-time collab (SPEC §9.2) — same-browser tabs share a BroadcastChannel and
  // can't show cross-machine remote carets. Both need `admin` or `owner` (the org roles
  // Better Auth's plugin issues) to pass the editor's "admin" feature gate.
  users: [
    { name: "Dev User", email: "dev@papervine.local", password: "password", role: "owner" },
    { name: "Dev User 2", email: "dev2@papervine.local", password: "password", role: "admin" },
  ],
  org: { name: "Dev Org", slug: "dev-org" },
  // All repos are synced into our object storage on seed (just like a real connect), so the
  // render path reads only from us — config, pages, AND assets. The canonical example/test
  // repo is **papervine/starter** (one repo to rule them all: the forkable user example AND
  // the renderer/reader-auth test bed). We point TWO sites at it:
  //   • `starter`        — reader-auth OFF: the public showcase + how the docs look ungated.
  //   • `starter-gated`  — reader-auth ON (JWT, with a REAL generated keypair): the RBAC test
  //                        bed. Its `internal/*` pages carry `groups:` frontmatter, so you can
  //                        mint a JWT for a given group (scripts/sign-reader-jwt.mjs) and watch
  //                        the per-page gate + nav-hiding (SPEC §11.2). The keypair is fresh
  //                        each seed; the sign script reads it back from the DB, so that's fine.
  // `large-docs` stays as a large real repo for exercising the renderer/nav at scale. The
  // first site is the "primary" (gets analytics seeded). Re-seeding resets all to this state.
  sites: [
    { name: "Starter Docs", slug: "starter", repoOwner: "papervine", repoName: "starter", branch: "main" },
    { name: "Starter (gated)", slug: "starter-gated", repoOwner: "papervine", repoName: "starter", branch: "main",
      auth: { method: "jwt", config: { loginUrl: "https://app.example.com/login" } } },
    { name: "Large Docs", slug: "large-docs", repoOwner: "papervine", repoName: "docs", branch: "main" },
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
// Mirrors sync-plan.ts RASTER_IMAGE_EXT: the formats we measure for next/image.
const RASTER_EXT = /\.(png|jpe?g|webp|avif|bmp)$/i;

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
  const dimensions = {};
  for (const f of files) {
    const res = await fetch(`${rawBase}/${f.path}`);
    if (!res.ok) continue;
    const isAsset = ASSET_EXT.test(f.path);
    let body;
    if (isAsset) {
      const bytes = new Uint8Array(await res.arrayBuffer());
      body = bytes;
      if (RASTER_EXT.test(f.path)) {
        try {
          const { width, height } = imageSize(bytes);
          if (width > 0 && height > 0) dimensions[f.path] = { width, height };
        } catch {
          // unreadable image — skip
        }
      }
    } else {
      body = await res.text();
    }
    await s3.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: `sites/${id}/${f.path}`,
        Body: body,
        ContentType: isAsset
          ? (res.headers.get("content-type") ?? undefined)
          : "text/plain; charset=utf-8",
      }),
    );
    count++;
  }
  // The dimensions manifest the render path reads to give next/image real width/height.
  await s3.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: `sites/${id}/.dimensions.json`,
      Body: JSON.stringify(dimensions),
      ContentType: "application/json",
    }),
  );
  return count;
}

// 0. Reset to ONLY seeded data (prod-guarded above). Truncate every dev/tenant table so
// leftover experiments — extra orgs, hand-connected sites, orphaned automations/sessions — are
// gone; the seed below rebuilds the fixtures from scratch. The billing CATALOG survives (it's
// `billing:sync` output, not dev data, and the seed reads it to put dev-org on Pro).
const CATALOG_TABLES = new Set([
  "billing_plan",
  "billing_plan_version",
  "billing_price",
  "credit_pack",
  "credit_rate_version",
]);
async function wipeDb() {
  const rows = await sql`select tablename from pg_tables where schemaname = 'public'`;
  const wipe = rows.map((r) => r.tablename).filter((t) => !CATALOG_TABLES.has(t));
  if (wipe.length) {
    await sql.unsafe(`TRUNCATE ${wipe.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
  }
  console.log(`• reset: truncated ${wipe.length} tables (kept the billing catalog)`);
}
// The content bucket only holds seed-regenerable site content (`sites/<id>/…`); clearing it
// keeps orphaned blobs from piling up as site ids change across reseeds. Non-fatal.
async function wipeStorage() {
  let removed = 0;
  let token;
  do {
    const list = await s3.send(
      new ListObjectsV2Command({ Bucket: S3_BUCKET, Prefix: "sites/", ContinuationToken: token }),
    );
    const objs = (list.Contents ?? []).map((o) => ({ Key: o.Key }));
    if (objs.length) {
      await s3.send(new DeleteObjectsCommand({ Bucket: S3_BUCKET, Delete: { Objects: objs } }));
      removed += objs.length;
    }
    token = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (token);
  console.log(`• reset: cleared ${removed} objects under sites/ in ${S3_BUCKET}`);
}
await wipeDb();
try {
  await wipeStorage();
} catch (e) {
  console.warn(`• storage wipe skipped (${e.message})`);
}

// 1. Users + credential accounts (Better Auth's `account` row holds the password hash).
const userIds = [];
for (const u of DEV.users) {
  let id = await findId("user", "email", u.email);
  const passwordHash = await hashPassword(u.password);
  if (id) {
    await sql`update account set password = ${passwordHash}, updated_at = ${now}
              where user_id = ${id} and provider_id = 'credential'`;
    console.log(`• user ${u.email} exists — refreshed password`);
  } else {
    id = randomUUID();
    await sql`insert into "user" (id, name, email, email_verified, created_at, updated_at)
              values (${id}, ${u.name}, ${u.email}, true, ${now}, ${now})`;
    await sql`insert into account (id, account_id, provider_id, user_id, password, created_at, updated_at)
              values (${randomUUID()}, ${id}, 'credential', ${id}, ${passwordHash}, ${now}, ${now})`;
    console.log(`• created user ${u.email}`);
  }
  userIds.push(id);
}
const userId = userIds[0]; // the primary — attributed as the actor on seeded activity/analytics.

// 2. Organization + membership for every seeded user (the dashboard lists orgs by membership).
let orgId = await findId("organization", "slug", DEV.org.slug);
if (!orgId) {
  orgId = randomUUID();
  await sql`insert into organization (id, name, slug, created_at)
            values (${orgId}, ${DEV.org.name}, ${DEV.org.slug}, ${now})`;
  console.log(`• created org ${DEV.org.slug}`);
}
for (const [i, u] of DEV.users.entries()) {
  const id = userIds[i];
  const member = await sql`select id from member where organization_id = ${orgId} and user_id = ${id} limit 1`;
  if (!member[0]) {
    await sql`insert into member (id, organization_id, user_id, role, created_at)
              values (${randomUUID()}, ${orgId}, ${id}, ${u.role}, ${now})`;
    console.log(`• added ${u.role} membership for ${u.email}`);
  } else {
    await sql`update member set role = ${u.role} where id = ${member[0].id}`;
  }
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
  // Reader-auth columns — set deterministically so re-seeding resets the known state. A JWT
  // site gets a freshly generated Ed25519 keypair (public key into auth_config, private key
  // encrypted into auth_secret_enc) so the handshake actually verifies.
  const authEnabled = !!s.auth;
  const authMethod = s.auth?.method ?? null;
  let configObj = s.auth?.config ?? null;
  let authSecretEnc = null;
  if (s.auth?.method === "jwt") {
    const { privateKeyPem, publicKeyPem } = genReaderKeypair();
    configObj = { ...(s.auth.config ?? {}), publicKey: publicKeyPem };
    authSecretEnc = encryptSecret(privateKeyPem);
  }
  const authConfig = configObj ? sql.json(configObj) : null;

  let siteId = await findId("site", "slug", s.slug);
  if (siteId) {
    await sql`update site set organization_id = ${orgId}, name = ${s.name},
              repo_owner = ${s.repoOwner}, repo_name = ${s.repoName},
              branch = ${s.branch}, status = 'live',
              auth_enabled = ${authEnabled}, auth_method = ${authMethod}, auth_config = ${authConfig},
              auth_secret_enc = ${authSecretEnc},
              updated_at = ${now} where id = ${siteId}`;
    console.log(`• site ${s.slug} exists — updated${authEnabled ? ` (auth: ${authMethod})` : ""}`);
  } else {
    siteId = randomUUID();
    await sql`insert into site (id, organization_id, name, slug, repo_owner, repo_name, branch, status,
                               auth_enabled, auth_method, auth_config, auth_secret_enc, created_at, updated_at)
              values (${siteId}, ${orgId}, ${s.name}, ${s.slug}, ${s.repoOwner},
                      ${s.repoName}, ${s.branch}, 'live',
                      ${authEnabled}, ${authMethod}, ${authConfig}, ${authSecretEnc}, ${now}, ${now})`;
    console.log(`• created site ${s.slug} → ${s.repoOwner}/${s.repoName}${authEnabled ? ` (auth: ${authMethod})` : ""}`);
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

// Billing state (SPEC §10 Billing): put dev-org on an ACTIVE Pro subscription with its
// monthly credit grant, so the seeded environment exercises the whole metered path
// (assistant/editor-agent authorize -> stream -> usage_event + ledger + balance). An
// org with NO billing row resolves to Free (no AI) — right for legacy prod orgs, wrong
// for a dev playground. Requires `npm run billing:sync` to have published the catalog;
// skipped with a warning otherwise. Idempotent: re-seeding resets to a fresh Pro state.
const [proVersion] = await sql`
  select id, included_monthly_credits from billing_plan_version
  where plan_key = 'pro' order by version desc limit 1`;
if (!proVersion) {
  console.warn("• billing skipped — no catalog in DB (run `npm run billing:sync` first)");
} else {
  const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const periodEnd = new Date(now.getTime() + 30 * 86_400_000);
  await sql`
    insert into billing_subscription (organization_id, plan_version_id, status, current_period_start, current_period_end)
    values (${orgId}, ${proVersion.id}, 'active', ${now}, ${periodEnd})
    on conflict (organization_id) do update set
      plan_version_id = ${proVersion.id}, status = 'active', trial_ends_at = null,
      current_period_start = ${now}, current_period_end = ${periodEnd}, updated_at = now()`;
  // Fresh monthly grant for this period (ledger + balance reset — dev only; prod grants
  // are written exactly once per period by the renewal webhook, enforced by the partial
  // unique index on (org, kind, period_key)).
  await sql`delete from credit_ledger where organization_id = ${orgId}`;
  await sql`delete from usage_event where organization_id = ${orgId}`;
  await sql`
    insert into credit_ledger (id, organization_id, delta, kind, bucket, period_key, expires_at, reason)
    values (${randomUUID()}, ${orgId}, ${proVersion.included_monthly_credits}, 'grant_monthly',
            'monthly', ${period}, ${periodEnd}, 'seed: Pro monthly grant')`;
  await sql`
    insert into credit_balance (organization_id, trial_credits, monthly_credits, pack_credits)
    values (${orgId}, 0, ${proVersion.included_monthly_credits}, 0)
    on conflict (organization_id) do update set
      trial_credits = 0, monthly_credits = ${proVersion.included_monthly_credits},
      pack_credits = 0, updated_at = now()`;
  console.log(`• billing: dev-org on Pro (active), ${proVersion.included_monthly_credits} monthly credits`);
}

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
  `\n✓ Seed complete. Log in at /login (two members — try both, in separate browser` +
    ` profiles, to exercise real-time collab):\n` +
    DEV.users.map((u) => `    ${u.email}  /  ${u.password}  (${u.role})`).join("\n") +
    `\n  Live docs (path form on a no-domain host):\n` +
    DEV.sites.map((s) => `    /sites/${s.slug}  (${s.repoOwner}/${s.repoName})`).join("\n"),
);
