"use server";

import { cookies } from "next/headers";
import { getSiteBySlug } from "@/lib/tenant";
import { decryptSecret } from "@/lib/crypto";
import { safeRedirect } from "@/lib/reader-auth";
import {
  READER_COOKIE,
  READER_SESSION_TTL_S,
  mintReaderSession,
  passwordMatches,
} from "@/lib/reader-session";

export type ReaderLoginState = { ok?: boolean; error?: string; redirectTo?: string };

/**
 * Verify the shared docs password (SPEC §11.2, password method) and, on success, set the
 * reader-session cookie and return the sanitized destination. We deliberately DON'T
 * `redirect()` from here: the gated docs live on a tenant host that the middleware
 * resolves from the Host header, and a server-action redirect to "/" is followed as a
 * soft RSC navigation that skips that Host rewrite — so "/" resolves to the apex
 * marketing home instead of the tenant's docs. The client does a full-page navigation
 * to `redirectTo` instead (re-running middleware), which lands on the docs correctly.
 * Returns an error string (no throw) so the form can show it inline; the stored secret
 * never leaves the server — we decrypt it only to compare.
 */
export async function submitReaderPassword(input: {
  slug: string;
  password: string;
  redirectTo: string;
}): Promise<ReaderLoginState> {
  const record = await getSiteBySlug(input.slug);
  if (
    !record?.authEnabled ||
    record.authMethod !== "password" ||
    !record.authSecretEnc
  ) {
    return { error: "Password sign-in isn't enabled for this site." };
  }

  let actual: string;
  try {
    actual = decryptSecret(record.authSecretEnc);
  } catch {
    // The encryption key is missing/rotated — fail closed rather than letting anyone in.
    return { error: "This site's authentication is misconfigured. Contact the owner." };
  }

  if (!passwordMatches(input.password, actual)) {
    return { error: "Incorrect password." };
  }

  (await cookies()).set(READER_COOKIE, mintReaderSession(record.id), {
    httpOnly: true,
    // Browsers drop Secure cookies over http://localhost in dev, so only set it in prod.
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: READER_SESSION_TTL_S,
  });

  // safeRedirect blocks an open-redirect via a crafted ?redirect= value.
  return { ok: true, redirectTo: safeRedirect(input.redirectTo, "/") };
}
