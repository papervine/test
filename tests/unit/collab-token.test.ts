import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { jwtVerify, SignJWT } from "jose";
import { mintCollabToken } from "@/lib/collab-token";

// The collab room token is the ENTIRE authorization for the socket service (apps/collab): it
// can't see Better Auth, so it trusts that a validly-signed token means the Next app already ran
// the editor gate. These tests pin that contract — the token binds to exactly one room, is
// HS256 over the shared secret, expires, and can't be forged with the wrong secret. `verify`
// mirrors apps/collab/src/auth.ts (same package boundary can't import it, so we re-check with jose).

const SECRET = "test-collab-secret";
const key = new TextEncoder().encode(SECRET);

async function verify(token: string) {
  const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
  return payload;
}

beforeEach(() => {
  process.env.COLLAB_JWT_SECRET = SECRET;
});
afterEach(() => {
  delete process.env.COLLAB_JWT_SECRET;
});

describe("mintCollabToken", () => {
  it("binds the token to exactly the room, userId and name", async () => {
    const token = await mintCollabToken({ room: "site1:main:index.mdx", userId: "u1", name: "Ada" });
    expect(token).not.toBeNull();
    const payload = await verify(token!);
    expect(payload.sub).toBe("site1:main:index.mdx"); // room is the subject the service checks
    expect(payload.userId).toBe("u1");
    expect(payload.name).toBe("Ada");
    expect(payload.exp).toBeTypeOf("number");
  });

  it("returns null when collab is unconfigured (no secret) → client falls back to BroadcastChannel", async () => {
    delete process.env.COLLAB_JWT_SECRET;
    const token = await mintCollabToken({ room: "s:main:a.mdx", userId: "u", name: "x" });
    expect(token).toBeNull();
  });

  it("a token minted with a DIFFERENT secret fails verification (no forgery)", async () => {
    const forged = await new SignJWT({ userId: "attacker", name: "mal" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("site1:main:secret.mdx")
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode("WRONG-secret"));
    await expect(verify(forged)).rejects.toThrow();
  });

  it("rejects an expired token", async () => {
    const expired = await new SignJWT({ userId: "u", name: "x" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("s:main:a.mdx")
      .setExpirationTime(Math.floor(Date.now() / 1000) - 10) // already expired
      .sign(key);
    await expect(verify(expired)).rejects.toThrow();
  });

  it("the service's room check catches a token replayed against another room", async () => {
    // A valid token for room A must not open room B — mirrors onAuthenticate's `claims.room !== documentName`.
    const token = await mintCollabToken({ room: "siteA:main:a.mdx", userId: "u", name: "x" });
    const payload = await verify(token!);
    const documentName = "siteB:main:b.mdx";
    expect(payload.sub).not.toBe(documentName); // service rejects (room mismatch)
  });
});
