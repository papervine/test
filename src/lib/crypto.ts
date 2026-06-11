import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Symmetric encryption for secrets we must store and later read back — currently a
// private repo's GitHub token (SPEC §3). AES-256-GCM (authenticated): tampering with
// the stored value fails the auth tag on decrypt rather than yielding garbage. The key
// lives only in env (PAPERVINE_ENCRYPTION_KEY), never in the DB, so a DB leak alone
// doesn't expose tokens. The GitHub App's private key will be stored the same way.

const IV_BYTES = 12; // GCM standard nonce length
const TAG_BYTES = 16;

function key(): Buffer {
  const raw = process.env.PAPERVINE_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "PAPERVINE_ENCRYPTION_KEY is not set — required to store private-repo tokens. " +
        "Generate one with: openssl rand -base64 32",
    );
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error("PAPERVINE_ENCRYPTION_KEY must decode to 32 bytes (use: openssl rand -base64 32).");
  }
  return buf;
}

// Output: base64( iv(12) | tag(16) | ciphertext ). Self-contained so the column needs
// no separate iv/tag fields and the format can carry its own nonce.
export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

export function decryptSecret(enc: string): string {
  const data = Buffer.from(enc, "base64");
  const iv = data.subarray(0, IV_BYTES);
  const tag = data.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = data.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
