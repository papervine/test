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
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
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
    // The site the MARKETING HOME's "Ask" demo talks to (SPEC §2). Uploaded from the in-repo
    // `docs/` directory rather than fetched, so it's the documentation in this very checkout.
    //
    // `customDomain: "docs.localhost"` is a LOOKUP KEY, not a servable host: `docs` is RESERVED
    // on the `.localhost` suffix (tenant-host.ts), so that host renders the marketing apex in
    // dev rather than this site. That's fine — resolveHomeDemo() only needs the row, and the
    // widget calls /api/widget/{id}/chat on the apex. Read the seeded docs at /sites/docs.
    // In prod the equivalent is the real, routed custom domain docs.papervine.io.
    {
      name: "Papervine Docs",
      slug: "docs",
      dir: "docs",
      customDomain: "docs.localhost",
      widget: true,
      repoOwner: "papervine",
      repoName: "papervine",
      branch: "main",
    },
  ],
};

/**
 * Origins the marketing home is served on locally — what the demo widget must allow.
 *
 * A RANGE, not just :3000, because `next dev` auto-picks the next free port when 3000 is busy,
 * which is the normal state with several worktrees running (CLAUDE.md → "Working across
 * worktrees"). Seeding one port means the demo silently falls back to link chips in every
 * worktree but the first, which reads as "the widget is broken" rather than "wrong origin".
 * Dev-only and localhost-only — the prod allowlist is set once in the dashboard.
 */
const DEV_WIDGET_ORIGINS = [
  ...new Set(
    ["3000", "3001", "3002", "3003", process.env.PORT].filter(Boolean).flatMap((port) => [
      `http://localhost:${port}`,
      `http://127.0.0.1:${port}`,
    ]),
  ),
];

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
// (keep the two in step). We copy the repo into the site's live revision exactly as a real
// deploy does, so isSynced() is true and the render path reads everything from us.
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

/**
 * The `PAPERVINE_STARTER_DIR` path: upload a local docs directory instead of fetching a repo.
 * Same uploads and same `.dimensions.json` manifest as the GitHub path, so what the renderer
 * reads is identical — only the transport differs.
 */
async function syncFromDisk({ dir, prefix }) {
  const files = [];
  (function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (TEXT_EXT.test(entry.name) || ASSET_EXT.test(entry.name)) {
        files.push(path.relative(dir, full).split(path.sep).join("/"));
      }
    }
  })(dir);

  const dimensions = {};
  for (const rel of files) {
    const isAsset = ASSET_EXT.test(rel);
    const bytes = readFileSync(path.join(dir, rel));
    if (isAsset && RASTER_EXT.test(rel)) {
      try {
        const { width, height } = imageSize(bytes);
        if (width > 0 && height > 0) dimensions[rel] = { width, height };
      } catch {
        // unreadable image — skip
      }
    }
    await s3.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: `${prefix}${rel}`,
        Body: isAsset ? new Uint8Array(bytes) : bytes.toString("utf8"),
        ContentType: isAsset ? undefined : "text/plain; charset=utf-8",
      }),
    );
  }
  await s3.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: `${prefix}.dimensions.json`,
      Body: JSON.stringify(dimensions),
      ContentType: "application/json",
    }),
  );
  console.log(`  ↳ ${files.length} files from ${dir} (local, sync path NOT exercised)`);
  return files.length;
}

/**
 * Copy a repo's docs (config + MDX + assets) into sites/{id}/… (mirrors syncSite).
 *
 * Deliberately fetches from GitHub rather than reading `examples/starter` off disk, even
 * though that directory is now the source of truth for `papervine/starter`. The fetch *is*
 * coverage: it walks the tree API and pulls raw blobs exactly as `syncSite` does, so seeding
 * doubles as a smoke test of the real sync path. Reading locally would quietly delete that.
 *
 * `PAPERVINE_STARTER_DIR` overrides it with a local directory for offline work or when the
 * unauthenticated GitHub rate limit bites — at the cost of not exercising sync.
 */
async function syncToStorage({ repoOwner, repoName, branch, prefix }) {
  const localDir = process.env.PAPERVINE_STARTER_DIR;
  if (localDir && repoOwner === "papervine" && repoName === "starter") {
    return syncFromDisk({ id, dir: path.resolve(localDir) });
  }
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
        Key: `${prefix}${f.path}`,
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
      Key: `${prefix}.dimensions.json`,
      Body: JSON.stringify(dimensions),
      ContentType: "application/json",
    }),
  );
  return count;
}

// 0. Reset to ONLY seeded data (prod-guarded above). Truncate every dev/tenant table so
// leftover experiments — extra orgs, hand-connected sites, orphaned automations/sessions — are
// gone; the seed below rebuilds the fixtures from scratch. One billing table survives the
// truncate: `credit_rate_version`, the token->credit rate tables usage is rated with. It is
// versioned, append-only reference data, not fixture data — wiping it would make every seeded
// usage_event row "unrated". (The rest of the old Postgres billing catalog is gone: Autumn holds
// plans and subscriptions now, and the contract migration dropped the tables.)
const CATALOG_TABLES = new Set(["credit_rate_version"]);
async function wipeDb() {
  const rows = await sql`select tablename from pg_tables where schemaname = 'public'`;
  const wipe = rows.map((r) => r.tablename).filter((t) => !CATALOG_TABLES.has(t));
  if (wipe.length) {
    await sql.unsafe(`TRUNCATE ${wipe.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
  }
  console.log(`• reset: truncated ${wipe.length} tables (kept the billing catalog)`);
}
// The content bucket only holds seed-regenerable site content; clearing it keeps orphaned
// blobs from piling up as site ids change across reseeds. Non-fatal.
//
// BOTH prefixes: `revs/<id>/<revision>/…` is where deploys write now (SPEC §10.11), and
// `sites/<id>/…` is the pre-revision layout still held by sites that haven't redeployed.
// Missing `revs/` here would leave every reseed's revision trees behind forever.
async function wipeStorage() {
  let removed = 0;
  for (const prefix of ["sites/", "revs/"]) {
    let token;
    do {
      const list = await s3.send(
        new ListObjectsV2Command({ Bucket: S3_BUCKET, Prefix: prefix, ContinuationToken: token }),
      );
      const objs = (list.Contents ?? []).map((o) => ({ Key: o.Key }));
      if (objs.length) {
        await s3.send(new DeleteObjectsCommand({ Bucket: S3_BUCKET, Delete: { Objects: objs } }));
        removed += objs.length;
      }
      token = list.IsTruncated ? list.NextContinuationToken : undefined;
    } while (token);
  }
  console.log(`• reset: cleared ${removed} objects under sites/ and revs/ in ${S3_BUCKET}`);
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
// Membership first (below), then the Autumn customer — the sync reads the owner's email off
// the member table. See after the membership loop.
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

// 2b. The org as an Autumn customer (SPEC §10 Billing). An org inserted by SQL bypasses the
// auth hook that gives a real new org its customer + 30-day trial, so without this dev-org
// resolves to the Free floor with nothing metered and the billing surfaces have nothing to
// show. Same trial a real signup gets. The org id is fresh on every reseed, so each reseed
// starts a clean customer in sandbox and leaves the previous one orphaned there — harmless,
// and truer to "full reset" than reusing an id that would carry test subscriptions across.
// Skipped, quietly, when AUTUMN_SECRET_KEY is unset: billing is optional for dev.
if (process.env.AUTUMN_SECRET_KEY) {
  const { syncAutumnCustomers, autumnEnvFor } = await import("./sync-autumn-customers.mjs");
  const env = autumnEnvFor(process.env.AUTUMN_SECRET_KEY);
  if (env !== "sandbox") {
    console.log(`• skipped Autumn sync: AUTUMN_SECRET_KEY is a ${env} key, and the seed only writes to sandbox`);
  } else {
    const results = await syncAutumnCustomers({
      sql,
      secretKey: process.env.AUTUMN_SECRET_KEY,
      apply: true,
      trial: true,
      log: (line) => console.log(`• autumn:${line}`),
    });
    if (results.some((r) => r.action === "error")) {
      console.warn("• Autumn sync had errors — dev-org may resolve to Free. Re-run: node --env-file=.env.local scripts/sync-autumn-customers.mjs --apply --trial");
    }
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

  // Widget columns — deterministic per seed, like the reader-auth keypair above. A widget id is
  // public by design (it sits in the script tag on every customer's page), so a fixed dev value
  // is fine and keeps the id stable across re-seeds.
  const widgetId = s.widget ? `widget_${s.slug}_dev` : null;
  const widgetOrigins = s.widget ? sql.json(DEV_WIDGET_ORIGINS) : sql.json([]);
  const customDomain = s.customDomain ?? null;
  const domainVerifiedAt = customDomain ? now : null;

  let siteId = await findId("site", "slug", s.slug);
  if (siteId) {
    await sql`update site set organization_id = ${orgId}, name = ${s.name},
              repo_owner = ${s.repoOwner}, repo_name = ${s.repoName},
              branch = ${s.branch}, status = 'live',
              auth_enabled = ${authEnabled}, auth_method = ${authMethod}, auth_config = ${authConfig},
              auth_secret_enc = ${authSecretEnc},
              custom_domain = ${customDomain}, custom_domain_verified_at = ${domainVerifiedAt},
              widget_id = ${widgetId}, widget_enabled = ${!!s.widget},
              widget_allowed_origins = ${widgetOrigins},
              updated_at = ${now} where id = ${siteId}`;
    console.log(`• site ${s.slug} exists — updated${authEnabled ? ` (auth: ${authMethod})` : ""}`);
  } else {
    siteId = randomUUID();
    await sql`insert into site (id, organization_id, name, slug, repo_owner, repo_name, branch, status,
                               auth_enabled, auth_method, auth_config, auth_secret_enc,
                               custom_domain, custom_domain_verified_at,
                               widget_id, widget_enabled, widget_allowed_origins, created_at, updated_at)
              values (${siteId}, ${orgId}, ${s.name}, ${s.slug}, ${s.repoOwner},
                      ${s.repoName}, ${s.branch}, 'live',
                      ${authEnabled}, ${authMethod}, ${authConfig}, ${authSecretEnc},
                      ${customDomain}, ${domainVerifiedAt},
                      ${widgetId}, ${!!s.widget}, ${widgetOrigins}, ${now}, ${now})`;
    console.log(`• created site ${s.slug} → ${s.repoOwner}/${s.repoName}${authEnabled ? ` (auth: ${authMethod})` : ""}`);
  }

  // Sync the repo into our object storage so the render path serves config, pages, AND
  // assets (logos/images) from us — never GitHub at request time.
  //
  // Into a REVISION (SPEC §10.11), exactly where a real deploy writes, with the site pointed
  // at it below. Seeding the pre-revision flat prefix instead would still render (the null
  // pointer falls back to it), but it would give dev a layout production no longer produces —
  // and no revision to roll back to.
  const seedRevisionId = randomUUID();
  let synced = false;
  try {
    // `dir` sites come from this checkout (the dogfood docs) rather than GitHub — the same
    // upload path PAPERVINE_STARTER_DIR uses, so what the renderer reads is identical.
    const prefix = `revs/${siteId}/${seedRevisionId}/`;
    const files = s.dir
      ? await syncFromDisk({ dir: path.resolve(s.dir), prefix })
      : await syncToStorage({
          repoOwner: s.repoOwner,
          repoName: s.repoName,
          branch: s.branch,
          prefix,
        });
    console.log(`  ↳ synced ${files} files into object storage`);
    synced = true;
  } catch (e) {
    console.warn(`  ↳ sync failed for ${s.slug}: ${e.message} — docs won't render until re-synced`);
  }

  await sql`delete from deployment where site_id = ${siteId}`;
  // The newest successful LIVE row owns the revision we just wrote, so the feed's top entry
  // is the one actually being served. The rest stay revision-less: they're synthetic rows with
  // no bytes behind them, and `canRollBack` correctly offers them no button rather than
  // promising a restore that would empty the site.
  let claimed = false;
  for (const d of feed) {
    const isLiveRevision =
      synced && !claimed && d.status === "successful" && d.target === "live";
    if (isLiveRevision) claimed = true;
    await sql`insert into deployment (id, site_id, status, target, commit_sha, commit_message, error, files_added, files_edited, actor_user_id, revision_id, created_at)
              values (${isLiveRevision ? seedRevisionId : randomUUID()}, ${siteId}, ${d.status}, ${d.target}, ${randomUUID().slice(0, 7)}, ${d.msg},
                      ${d.err}, ${d.added}, ${d.edited}, ${userId}, ${isLiveRevision ? seedRevisionId : null}, ${d.at})`;
  }
  if (synced) {
    await sql`update site set live_revision_id = ${seedRevisionId} where id = ${siteId}`;
  }
}
console.log(`• seeded ${DEV.sites.length} sites + ${feed.length} activity rows each`);

// Metered usage history (SPEC §10 Billing). Plan state itself is no longer seeded here:
// Autumn is the source of truth for subscriptions and balances, so a dev org's plan is
// whatever Autumn says (Free by default, since `getOrCreate` auto-enables it). To dogfood
// a paid tier locally, attach it in the Autumn dashboard — that is the support surface
// (the in-app comp console was removed 2026-09-01; Autumn's own UI is the audited one).
//
// What still belongs in the seed is `usage_event`, because that table stays ours — it is
// the record of WHICH feature spent credits, and it is what Settings → Usage charts. An
// org that has never called an AI route draws an empty chart, which tells you nothing
// about whether the surface works.
// 30 days of metered history, so Settings → Usage has a chart to draw (an org that has
// never called an AI route shows an empty one, which tells you nothing about whether
// the surface works). Deterministic, not random: a fixed per-day pattern per feature so
// two seeds produce the same bars and a screenshot diff means something. Written as
// usage_event rows, the same shape recordAiUsage writes, so the chart and the product
// agree about what a day of usage looks like.
const MODELS = {
  assistant: "claude-haiku-4-5-20251001",
  writer: "claude-sonnet-5",
  workflow: "claude-sonnet-5",
};
const usageRows = [];
for (let back = 29; back >= 0; back--) {
  const day = new Date(now.getTime() - back * 86_400_000);
  // A weekday-ish rhythm (quiet weekends) with each feature at its own scale:
  // assistant ~50% of the spend, editor agent ~30%, automations ~20%.
  const weekend = day.getDay() === 0 || day.getDay() === 6;
  const wave = 1 + 0.35 * Math.sin(back / 2.7);
  const scale = (weekend ? 0.35 : 1) * wave;
  for (const [feature, share, calls] of [
    ["assistant", 500, 8],
    ["writer", 300, 3],
    ["workflow", 200, 1],
  ]) {
    // Skip the odd feature on the odd day so some bars are two-segment, not three —
    // that's the case where a legend/tooltip mixes up its series alignment.
    if ((back + share) % 7 === 0) continue;
    for (let i = 0; i < calls; i++) {
      const credits = Math.max(1, Math.round((share / calls) * scale));
      const at = new Date(day);
      at.setHours(9 + i, (17 * i) % 60, 0, 0);
      const id = randomUUID();
      usageRows.push({
        id,
        organization_id: orgId,
        site_id: null,
        feature,
        model: MODELS[feature],
        tokens_in: credits * 90,
        tokens_out: credits * 30,
        credits,
        rate_version: 1,
        request_id: null,
        created_at: at,
      });
    }
  }
}
await sql`delete from usage_event where organization_id = ${orgId}`;
await sql`insert into usage_event ${sql(usageRows)}`;
const burned = usageRows.reduce((sum, r) => sum + r.credits, 0);
console.log(
  `• usage: ${burned} credits over 30 days (${usageRows.length} metered calls) for the chart`,
);

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
    DEV.sites
      .map((s) => `    /sites/${s.slug}  (${s.dir ? `./${s.dir}` : `${s.repoOwner}/${s.repoName}`})`)
      .join("\n") +
    `\n  Marketing home demo: the "Ask" chips are live (widget on the docs site, origins` +
    ` ${DEV_WIDGET_ORIGINS.join(", ")}).`,
);
