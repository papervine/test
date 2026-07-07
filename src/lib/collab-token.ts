import "server-only";
import { SignJWT } from "jose";

// Short-lived token that authorizes ONE collaborative room on the standalone Hocuspocus
// service (apps/collab). The Next app is the only thing that can talk to the session/RBAC
// layer, so it does the real check (gateEditor) and mints this token; the socket service —
// which has no Better Auth — just verifies the signature and that the room it's being asked
// to open matches the room this token was minted for. Symmetric HS256 with a shared
// COLLAB_JWT_SECRET (both are OUR services; the asymmetric EdDSA dance in reader-jwt.ts is for
// an *untrusted* customer backend, which this isn't).
//
// The room string is `${siteId}:${branch}:${path}` — the draftFile grain. Because gateEditor
// already proved the user may edit this site, binding the token to that exact room is the whole
// authorization: the service never has to know what a site or a role is.

export interface CollabClaims {
  room: string;
  userId: string;
  name: string;
}

const secretKey = (): Uint8Array | null => {
  const s = process.env.COLLAB_JWT_SECRET;
  return s ? new TextEncoder().encode(s) : null;
};

/**
 * Mint a ~5-minute room token, or null when collab is unconfigured (no COLLAB_JWT_SECRET) —
 * the caller degrades to the same-browser BroadcastChannel transport, never an error.
 */
export async function mintCollabToken(claims: CollabClaims): Promise<string | null> {
  const key = secretKey();
  if (!key) return null;
  return new SignJWT({ name: claims.name, userId: claims.userId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.room) // the room this token unlocks; the service checks it verbatim
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key);
}
