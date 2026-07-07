import { jwtVerify } from "jose";

// Verify a room token minted by the Next app (src/lib/collab-token.ts). Symmetric HS256 with the
// shared COLLAB_JWT_SECRET — this service can't see Better Auth, so the signed room claim IS the
// authorization: the Next app already ran the editor gate before signing. We only check the
// signature, expiry, and that the room matches what the client is trying to open.

export interface CollabClaims {
  room: string; // `${siteId}:${branch}:${path}` — must equal the Hocuspocus document name
  userId: string;
  name: string;
}

const key = process.env.COLLAB_JWT_SECRET
  ? new TextEncoder().encode(process.env.COLLAB_JWT_SECRET)
  : null;

export function isConfigured(): boolean {
  return key !== null;
}

/** Returns the verified claims, or null on any failure (bad sig, expired, malformed, unset secret). */
export async function verifyCollabToken(token: string | undefined): Promise<CollabClaims | null> {
  if (!key || !token) return null;
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
    const room = payload.sub;
    const { userId, name } = payload as { userId?: unknown; name?: unknown };
    if (typeof room !== "string" || typeof userId !== "string") return null;
    return { room, userId, name: typeof name === "string" ? name : "Editor" };
  } catch {
    return null;
  }
}
