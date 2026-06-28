// Mint a reader-auth JWT for a seeded JWT-gated site, the way a customer's backend would —
// so you can exercise per-page RBAC (SPEC §11.2) locally. Reads the site's Ed25519 private
// key back out of the DB (seeded by scripts/seed-dev.mjs), signs an EdDSA token carrying the
// groups you pass, and prints the `/login/jwt-callback#…` URL to open in a browser.
//
//   node --env-file=.env.local scripts/sign-reader-jwt.mjs --groups admin
//   node --env-file=.env.local scripts/sign-reader-jwt.mjs --groups beta --host starter-gated.localhost:3000
//   node --env-file=.env.local scripts/sign-reader-jwt.mjs            # no groups (ungated/public only)
//
// Open the printed URL in a browser: the gated `internal/*` pages should appear/404 per the
// groups you signed, and the sidebar hides what you can't see.
import { createDecipheriv } from "node:crypto";
import postgres from "postgres";
import { SignJWT, importPKCS8 } from "jose";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const slug = arg("slug", "starter-gated");
const host = arg("host", `${slug}.localhost:3000`);
const groupsArg = arg("groups", "");
const groups = groupsArg ? groupsArg.split(",").map((g) => g.trim()).filter(Boolean) : [];

function decryptSecret(enc) {
  const key = Buffer.from(process.env.PAPERVINE_ENCRYPTION_KEY, "base64");
  const data = Buffer.from(enc, "base64");
  const d = createDecipheriv("aes-256-gcm", key, data.subarray(0, 12));
  d.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([d.update(data.subarray(28)), d.final()]).toString("utf8");
}

const sql = postgres(process.env.DATABASE_URL);
const [row] = await sql`
  select auth_method, auth_secret_enc, auth_config from site where slug = ${slug} limit 1`;
await sql.end();

if (!row) throw new Error(`site '${slug}' not found — run: npm run db:seed`);
if (row.auth_method !== "jwt" || !row.auth_secret_enc) {
  throw new Error(`site '${slug}' isn't JWT-gated with a keypair (auth_method=${row.auth_method})`);
}

const key = await importPKCS8(decryptSecret(row.auth_secret_enc), "EdDSA");
const token = await new SignJWT({
  host, // must equal the docs host
  expiresAt: Math.floor(Date.now() / 1000) + 60 * 60 * 24, // 1-day docs session
  groups,
})
  .setProtectedHeader({ alg: "EdDSA" })
  .setIssuedAt()
  // Prod keeps the handoff token ≤10s; this is a manual test helper, so allow a few minutes
  // of headroom between minting the URL and opening it in a browser.
  .setExpirationTime("5m")
  .sign(key);

console.log(`\nsite:   ${slug}  (host ${host})`);
console.log(`groups: ${groups.length ? groups.join(", ") : "(none — ungated/public pages only)"}`);
console.log(`\nOpen in a browser (token in the hash, never logged):\n`);
console.log(`http://${host}/login/jwt-callback?redirect=%2F#${token}\n`);
