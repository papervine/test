import { describe, it, expect, vi } from "vitest";
import { SignJWT } from "jose";

// The collab SERVICE side of the room token (apps/collab/src/auth.ts). The token is the ENTIRE
// authorization for the socket service — it can't see Better Auth, so a validly-signed token for a
// room IS permission to open exactly that room. These tests exercise the service's real verifier
// (not a re-implementation) and pin the security-critical invariant: a token authorizes ONLY its
// own room, so one editor can never join another site's/page's document. The app-side minting is
// covered by collab-token.test.ts; here we defend the gate.

const SECRET = "test-collab-secret";
const key = new TextEncoder().encode(SECRET);
const wrongKey = new TextEncoder().encode("attacker-secret");

/** Sign a room token the way src/lib/collab-token.ts does, so we test the real handshake. */
async function mint(
  room: string,
  opts: { userId?: string; name?: string; signingKey?: Uint8Array; expSecondsFromNow?: number } = {},
) {
  const { userId = "u1", name = "Ada", signingKey = key, expSecondsFromNow = 300 } = opts;
  const nowSec = Math.floor(Date.now() / 1000);
  return new SignJWT({ userId, name })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(room)
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + expSecondsFromNow)
    .sign(signingKey);
}

/** Load a FRESH copy of the auth module with the given secret (it captures the key at import). */
async function loadAuth(secret: string | undefined) {
  vi.resetModules();
  if (secret === undefined) delete process.env.COLLAB_JWT_SECRET;
  else process.env.COLLAB_JWT_SECRET = secret;
  return import("../../apps/collab/src/auth");
}

describe("collab service — authorizeConnection (room isolation)", () => {
  it("accepts a valid token whose room matches the document being opened", async () => {
    const { authorizeConnection } = await loadAuth(SECRET);
    const token = await mint("site1:main:index.mdx", { userId: "u1", name: "Ada" });
    const claims = await authorizeConnection(token, "site1:main:index.mdx");
    expect(claims).toEqual({ room: "site1:main:index.mdx", userId: "u1", name: "Ada" });
  });

  it("REJECTS a valid token for a different room (cross-page/site join)", async () => {
    const { authorizeConnection } = await loadAuth(SECRET);
    const token = await mint("site1:main:index.mdx");
    expect(await authorizeConnection(token, "site2:main:index.mdx")).toBeNull();
    expect(await authorizeConnection(token, "site1:main:secret.mdx")).toBeNull();
  });

  it("rejects a token forged with the wrong secret", async () => {
    const { authorizeConnection } = await loadAuth(SECRET);
    const forged = await mint("site1:main:index.mdx", { signingKey: wrongKey });
    expect(await authorizeConnection(forged, "site1:main:index.mdx")).toBeNull();
  });

  it("rejects an expired token even for the right room", async () => {
    const { authorizeConnection } = await loadAuth(SECRET);
    const stale = await mint("site1:main:index.mdx", { expSecondsFromNow: -60 });
    expect(await authorizeConnection(stale, "site1:main:index.mdx")).toBeNull();
  });

  it("rejects a malformed or missing token", async () => {
    const { authorizeConnection } = await loadAuth(SECRET);
    expect(await authorizeConnection("not-a-jwt", "site1:main:index.mdx")).toBeNull();
    expect(await authorizeConnection(undefined, "site1:main:index.mdx")).toBeNull();
  });

  it("defaults a missing display name to 'Editor'", async () => {
    const { authorizeConnection } = await loadAuth(SECRET);
    // A token carrying userId but no name.
    const token = await new SignJWT({ userId: "u9" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("s:main:p.mdx")
      .setExpirationTime("5m")
      .sign(key);
    const claims = await authorizeConnection(token, "s:main:p.mdx");
    expect(claims).toMatchObject({ userId: "u9", name: "Editor" });
  });

  it("refuses to authorize anything when no secret is configured", async () => {
    const { authorizeConnection, isConfigured, verifyCollabToken } = await loadAuth(undefined);
    expect(isConfigured()).toBe(false);
    // Even a token that WAS validly signed can't be verified without the secret loaded.
    const token = await mint("site1:main:index.mdx");
    expect(await verifyCollabToken(token)).toBeNull();
    expect(await authorizeConnection(token, "site1:main:index.mdx")).toBeNull();
  });

  it("reports configured when the secret is set", async () => {
    const { isConfigured } = await loadAuth(SECRET);
    expect(isConfigured()).toBe(true);
  });
});
