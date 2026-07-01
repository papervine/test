import { describe, it, expect, vi, beforeEach } from "vitest";

// Regression: switching the reader-auth method must NOT regenerate or clear the JWT keypair —
// only the explicit Regenerate button does. The verify path reads authConfig.publicKey, so a
// mint-on-switch invalidates every reader JWT the customer already signed ("Could not verify
// your sign-in token"). We assert on the db.update().set() payload: what the switch persists.

const { store, db, crypto, jwt } = vi.hoisted(() => ({
  store: {
    active: null as null | Record<string, unknown>,
    setPayload: null as null | Record<string, unknown>,
  },
  db: {},
  crypto: { encryptSecret: vi.fn((s: string) => `enc(${s})`) },
  jwt: {
    generateEd25519Keypair: vi.fn(async () => ({
      privateKeyPem: "-----BEGIN PRIVATE KEY-----\nNEW\n-----END PRIVATE KEY-----",
      publicKeyPem: "-----BEGIN PUBLIC KEY-----\nNEWPUB\n-----END PUBLIC KEY-----",
    })),
  },
}));

// db.update(site).set(payload).where(cond) — capture the payload the action persists.
vi.mock("@/lib/db", () => ({
  db: {
    update: () => ({
      set: (payload: Record<string, unknown>) => {
        store.setPayload = payload;
        return { where: () => Promise.resolve() };
      },
    }),
  },
}));
vi.mock("@/lib/db/app-schema", () => ({ site: {} }));
vi.mock("@/lib/dashboard-context", () => ({ findSite: vi.fn(async () => store.active) }));
vi.mock("@/lib/tenant", () => ({ revalidateSiteRow: vi.fn() }));
vi.mock("@/lib/dashboard-nav", () => ({ siteRoute: () => "/app/o/s/settings/authentication" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/crypto", () => crypto);
vi.mock("@/lib/reader-jwt", () => jwt);

import { setAuthMethod } from "../../src/app/app/[org]/[site]/settings/authentication/actions";

const ref = { org: "o", site: "s" };
const withKeypair = {
  id: "site1",
  slug: "s",
  customDomain: null,
  authConfig: { publicKey: "-----BEGIN PUBLIC KEY-----\nOLDPUB\n-----END PUBLIC KEY-----", loginUrl: "https://x/login" },
};

beforeEach(() => {
  vi.clearAllMocks();
  store.setPayload = null;
});

describe("setAuthMethod preserves the JWT keypair across switches", () => {
  it("switching JWT → password does NOT clear the secret or the public key", async () => {
    store.active = { ...withKeypair, authMethod: "jwt" };
    await setAuthMethod(ref, "password");

    expect(store.setPayload?.authMethod).toBe("password");
    // The keypair columns are left untouched (no authSecretEnc / authConfig in the update).
    expect(store.setPayload).not.toHaveProperty("authSecretEnc");
    expect(store.setPayload).not.toHaveProperty("authConfig");
    expect(jwt.generateEd25519Keypair).not.toHaveBeenCalled();
  });

  it("switching back to JWT reuses the existing keypair — does NOT regenerate", async () => {
    store.active = { ...withKeypair, authMethod: "password" };
    await setAuthMethod(ref, "jwt");

    expect(store.setPayload?.authMethod).toBe("jwt");
    expect(store.setPayload).not.toHaveProperty("authConfig"); // publicKey unchanged
    expect(jwt.generateEd25519Keypair).not.toHaveBeenCalled();
  });

  it("mints a keypair only when switching to JWT and none exists yet", async () => {
    store.active = { ...withKeypair, authMethod: "password", authConfig: {} }; // no publicKey
    await setAuthMethod(ref, "jwt");

    expect(jwt.generateEd25519Keypair).toHaveBeenCalledOnce();
    expect((store.setPayload?.authConfig as { publicKey?: string })?.publicKey).toContain("NEWPUB");
    expect(store.setPayload?.authSecretEnc).toContain("enc(");
  });
});
