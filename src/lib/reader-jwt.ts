import "server-only";
import {
  SignJWT,
  jwtVerify,
  generateKeyPair,
  exportPKCS8,
  exportSPKI,
  importSPKI,
  importPKCS8,
  errors as joseErrors,
} from "jose";

// Layer 2 reader-auth, JWT handshake (SPEC §11.2, method 1 — "EdDSA only"). We mirror
// hosted docs platforms' flow exactly so their configs migrate unchanged: we generate a per-site
// Ed25519 keypair, the customer's backend signs a short-lived JWT with the *private* key
// (`{alg:'EdDSA'}`) after its own login, and redirects the browser to
// `{DOCS_HOST}/login/jwt-callback#{JWT}` (token in the URL hash, never logged). We verify
// the signature here with the *public* key — asymmetric on purpose: the verifier never
// needs a forging-capable secret, which is what lets the gate move to the edge later
// (SPEC §11.2 → Planned: public key in Edge Config, private key never leaves origin).
//
// jose is Web-Crypto based (edge-runtime compatible), so this whole module is portable to
// middleware once key *storage* (node:crypto AES-GCM in crypto.ts) is the only node-bound
// piece left.

// EdDSA only — never widen this. Accepting any other alg (incl. an attacker-supplied "none"
// or a symmetric HS256 whose key is our public key) would defeat the asymmetric guarantee.
const ALG = "EdDSA" as const;

// The reader identity the customer asserts (docs.json-compatible `User`). All optional: a
// minimal token just proves "this user cleared your login". `host` is the anti-replay bind
// (must equal the docs domain); `expiresAt` sets our docs-session length; `groups` drives
// page access control; `content` is per-reader personalization exposed as `user` in MDX.
export type ReaderJwtUser = {
  host?: string;
  expiresAt?: number; // unix seconds
  groups?: string[];
  content?: Record<string, unknown>;
  apiPlaygroundInputs?: {
    server?: Record<string, unknown>;
    header?: Record<string, unknown>;
    query?: Record<string, unknown>;
    cookie?: Record<string, unknown>;
    path?: Record<string, unknown>;
  };
};

export type VerifyResult =
  | { ok: true; user: ReaderJwtUser }
  | { ok: false; error: string };

/**
 * Generate a fresh per-site Ed25519 keypair, exported as PEM. The private key (PKCS#8) is
 * handed to the customer to sign with and stored encrypted; the public key (SPKI) is stored
 * in plaintext config and is the only thing the verify path needs.
 */
export async function generateEd25519Keypair(): Promise<{
  privateKeyPem: string;
  publicKeyPem: string;
}> {
  const { publicKey, privateKey } = await generateKeyPair(ALG, {
    crv: "Ed25519",
    extractable: true,
  });
  return {
    privateKeyPem: await exportPKCS8(privateKey),
    publicKeyPem: await exportSPKI(publicKey),
  };
}

/**
 * Verify a reader JWT against the site's public key. Enforces:
 *  - EdDSA signature (algorithms pinned — no alg confusion / "none"),
 *  - not expired (`exp`; jose checks this against `now`),
 *  - `host` claim equals the docs domain (blocks replaying a token captured on one site
 *    against another, and a token minted for a different host).
 * Never throws — returns a typed result so the callback can show an inline error.
 */
export async function verifyReaderJwt(
  token: string,
  publicKeyPem: string,
  expectedHost: string,
  now: number = Date.now(),
): Promise<VerifyResult> {
  let key;
  try {
    key = await importSPKI(publicKeyPem, ALG);
  } catch {
    // A malformed/empty stored public key — misconfiguration, fail closed.
    return { ok: false, error: "This site's authentication is misconfigured." };
  }

  let payload;
  try {
    ({ payload } = await jwtVerify(token, key, {
      algorithms: [ALG],
      currentDate: new Date(now),
    }));
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) {
      return { ok: false, error: "This sign-in link has expired. Please sign in again." };
    }
    // Bad signature, wrong alg, malformed token — all "couldn't verify".
    return { ok: false, error: "Could not verify your sign-in token." };
  }

  const user = payload as ReaderJwtUser;
  if (!user.host || user.host !== expectedHost) {
    return { ok: false, error: "This sign-in token isn't valid for this site." };
  }
  return { ok: true, user };
}

// Re-exported for tests: lets the test suite sign a token the same way a customer backend
// would, without importing jose directly in test files.
export async function signReaderJwtForTest(
  privateKeyPem: string,
  claims: ReaderJwtUser,
  expiresIn: string = "10s",
): Promise<string> {
  const key = await importPKCS8(privateKeyPem, ALG);
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key);
}
