"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { site } from "@/lib/db/app-schema";
import { requireActiveSite } from "@/lib/require-active-site";
import { encryptSecret } from "@/lib/crypto";
import {
  type AuthMethod,
  isAuthMethod,
  validateAuthConfig,
} from "@/lib/reader-auth";

export type AuthActionState = { ok?: boolean; error?: string };

const AUTH_PATH = "/dashboard/settings/authentication";

// A shared HMAC signing secret the customer's backend uses to sign reader JWTs (SPEC
// §11.2). Prefixed so it's recognizable in logs/config and base64url so it's copy-safe.
function newJwtSecret(): string {
  return `papervine_jwt_${randomBytes(32).toString("base64url")}`;
}

// Master switch. Enabling for the first time seeds the JWT method (the spec's first
// handshake) with a freshly minted signing secret so the surface is immediately usable.
export async function setAuthEnabled(enabled: boolean): Promise<AuthActionState> {
  const active = await requireActiveSite();
  if (!active) return { error: "No active site." };

  const seed =
    enabled && !active.authMethod
      ? { authMethod: "jwt", authSecretEnc: encryptSecret(newJwtSecret()) }
      : {};

  await db
    .update(site)
    .set({ authEnabled: enabled, ...seed, updatedAt: new Date() })
    .where(eq(site.id, active.id));
  revalidatePath(AUTH_PATH);
  return { ok: true };
}

// Switch the active handshake method. The stored secret is method-specific (a JWT
// signing secret is meaningless as an OAuth client secret), so switching resets it:
// JWT mints a fresh signing secret, the others clear it so their secret field starts
// empty rather than inheriting the previous method's value.
export async function setAuthMethod(method: string): Promise<AuthActionState> {
  const active = await requireActiveSite();
  if (!active) return { error: "No active site." };
  if (!isAuthMethod(method)) return { error: "Unknown auth method." };

  const secretReset =
    method === "jwt"
      ? { authSecretEnc: encryptSecret(newJwtSecret()) }
      : { authSecretEnc: null };

  await db
    .update(site)
    .set({ authMethod: method, ...secretReset, updatedAt: new Date() })
    .where(eq(site.id, active.id));
  revalidatePath(AUTH_PATH);
  return { ok: true };
}

// Persist the per-method config. Validation is pure (src/lib/reader-auth.ts); the secret
// is encrypted before it ever touches the row, and a null secret leaves the stored one
// untouched (the user didn't change it).
export async function saveAuthConfig(input: {
  method: AuthMethod;
  loginUrl?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  userInfoUrl?: string;
  clientId?: string;
  scopes?: string;
  secret?: string;
}): Promise<AuthActionState> {
  const active = await requireActiveSite();
  if (!active) return { error: "No active site." };
  if (!isAuthMethod(input.method)) return { error: "Unknown auth method." };

  const result = validateAuthConfig(input.method, input);
  if (!result.ok) return { error: result.error };

  await db
    .update(site)
    .set({
      authMethod: input.method,
      authConfig: result.config,
      ...(result.secret !== null
        ? { authSecretEnc: encryptSecret(result.secret) }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(site.id, active.id));
  revalidatePath(AUTH_PATH);
  return { ok: true };
}

// Rotate the JWT signing secret. The customer must update their backend with the new
// value; until they do, freshly signed tokens won't verify — hence an explicit action.
export async function regenerateJwtSecret(): Promise<AuthActionState> {
  const active = await requireActiveSite();
  if (!active) return { error: "No active site." };

  await db
    .update(site)
    .set({ authSecretEnc: encryptSecret(newJwtSecret()), updatedAt: new Date() })
    .where(eq(site.id, active.id));
  revalidatePath(AUTH_PATH);
  return { ok: true };
}
