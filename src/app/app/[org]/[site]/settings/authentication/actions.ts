"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { site } from "@/lib/db/app-schema";
import { findSite } from "@/lib/dashboard-context";
import { revalidateSiteRow } from "@/lib/tenant";
import { siteRoute } from "@/lib/dashboard-nav";
import { encryptSecret } from "@/lib/crypto";
import { generateEd25519Keypair } from "@/lib/reader-jwt";
import {
  type AuthMethod,
  type ReaderAuthConfig,
  isAuthMethod,
  validateAuthConfig,
} from "@/lib/reader-auth";

export type AuthActionState = { ok?: boolean; error?: string };

// The site these actions mutate, carried from the URL-scoped page (/:org/:site) since a
// server action has no params of its own. findSite re-authorizes it server-side.
export type SiteRef = { org: string; site: string };

// Internal route to revalidate (Next keys the cache by the real /app mount, not the
// rewritten-away public URL).
const authPath = (ref: SiteRef) =>
  siteRoute(ref.org, ref.site, "settings/authentication");

// Mint a fresh per-site Ed25519 keypair (SPEC §11.2 — "EdDSA only") and return the row
// fields to persist: the private key (PKCS#8 PEM) AES-GCM-encrypted for the customer to
// sign with, and the public key (SPKI PEM) merged into authConfig for the verify path. We
// merge into `existing` so regenerating/switching doesn't clobber a configured loginUrl.
async function newJwtKeyFields(
  existing: ReaderAuthConfig | null | undefined,
): Promise<{ authSecretEnc: string; authConfig: ReaderAuthConfig }> {
  const { privateKeyPem, publicKeyPem } = await generateEd25519Keypair();
  return {
    authSecretEnc: encryptSecret(privateKeyPem),
    authConfig: { ...(existing ?? {}), publicKey: publicKeyPem },
  };
}

// Master switch. Enabling for the first time seeds the JWT method (the spec's first
// handshake) with a freshly minted Ed25519 keypair so the surface is immediately usable.
export async function setAuthEnabled(
  ref: SiteRef,
  enabled: boolean,
): Promise<AuthActionState> {
  const active = await findSite(ref.org, ref.site);
  if (!active) return { error: "No active site." };

  const seed =
    enabled && !active.authMethod
      ? {
          authMethod: "jwt",
          ...(await newJwtKeyFields(active.authConfig as ReaderAuthConfig | null)),
        }
      : {};

  await db
    .update(site)
    .set({ authEnabled: enabled, ...seed, updatedAt: new Date() })
    .where(eq(site.id, active.id));
  // Bust the cached site row so the gate sees the new authEnabled immediately — a site toggled
  // ON must not keep serving publicly for the TTL window (SPEC §11.2).
  revalidateSiteRow({ slug: active.slug, domains: [active.customDomain] });
  revalidatePath(authPath(ref));
  return { ok: true };
}

// Switch the active handshake method. The stored secret is method-specific (a JWT private
// key is meaningless as an OAuth client secret), so switching resets it: JWT mints a fresh
// Ed25519 keypair, the others clear it so their secret field starts empty rather than
// inheriting the previous method's value.
export async function setAuthMethod(
  ref: SiteRef,
  method: string,
): Promise<AuthActionState> {
  const active = await findSite(ref.org, ref.site);
  if (!active) return { error: "No active site." };
  if (!isAuthMethod(method)) return { error: "Unknown auth method." };

  const secretReset =
    method === "jwt"
      ? await newJwtKeyFields(active.authConfig as ReaderAuthConfig | null)
      : { authSecretEnc: null };

  await db
    .update(site)
    .set({ authMethod: method, ...secretReset, updatedAt: new Date() })
    .where(eq(site.id, active.id));
  revalidateSiteRow({ slug: active.slug, domains: [active.customDomain] });
  revalidatePath(authPath(ref));
  return { ok: true };
}

// Persist the per-method config. Validation is pure (src/lib/reader-auth.ts); the secret
// is encrypted before it ever touches the row, and a null secret leaves the stored one
// untouched (the user didn't change it).
export async function saveAuthConfig(
  ref: SiteRef,
  input: {
    method: AuthMethod;
    loginUrl?: string;
    authorizationUrl?: string;
    tokenUrl?: string;
    userInfoUrl?: string;
    clientId?: string;
    scopes?: string;
    secret?: string;
  },
): Promise<AuthActionState> {
  const active = await findSite(ref.org, ref.site);
  if (!active) return { error: "No active site." };
  if (!isAuthMethod(input.method)) return { error: "Unknown auth method." };

  const result = validateAuthConfig(input.method, input);
  if (!result.ok) return { error: result.error };

  // The JWT public key is server-managed (minted with the keypair), not part of the form,
  // so preserve it when the form saves loginUrl — otherwise editing the URL would wipe the
  // verify key. The other methods have no such carried field.
  const config: ReaderAuthConfig =
    input.method === "jwt"
      ? {
          ...result.config,
          publicKey: (active.authConfig as ReaderAuthConfig | null)?.publicKey,
        }
      : result.config;

  await db
    .update(site)
    .set({
      authMethod: input.method,
      authConfig: config,
      ...(result.secret !== null
        ? { authSecretEnc: encryptSecret(result.secret) }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(site.id, active.id));
  revalidateSiteRow({ slug: active.slug, domains: [active.customDomain] });
  revalidatePath(authPath(ref));
  return { ok: true };
}

// Rotate the JWT keypair. The customer must update their backend with the new private key;
// until they do, freshly signed tokens won't verify — hence an explicit action.
export async function regenerateJwtKeypair(ref: SiteRef): Promise<AuthActionState> {
  const active = await findSite(ref.org, ref.site);
  if (!active) return { error: "No active site." };

  await db
    .update(site)
    .set({
      ...(await newJwtKeyFields(active.authConfig as ReaderAuthConfig | null)),
      updatedAt: new Date(),
    })
    .where(eq(site.id, active.id));
  revalidateSiteRow({ slug: active.slug, domains: [active.customDomain] });
  revalidatePath(authPath(ref));
  return { ok: true };
}
