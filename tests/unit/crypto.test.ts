import { describe, it, expect, beforeAll } from "vitest";
import { encryptSecret, decryptSecret } from "@/lib/crypto";

// A deterministic 32-byte key for the test (real keys come from `openssl rand -base64 32`).
const KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");

describe("crypto (AES-256-GCM secret storage)", () => {
  beforeAll(() => {
    process.env.PAPERVINE_ENCRYPTION_KEY = KEY;
  });

  it("round-trips a token", () => {
    const token = "github_pat_11ABCDEF0_secretsecretsecret";
    expect(decryptSecret(encryptSecret(token))).toBe(token);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("rejects a tampered ciphertext (auth tag)", () => {
    const enc = encryptSecret("secret");
    const data = Buffer.from(enc, "base64");
    data[data.length - 1] ^= 0xff; // flip a ciphertext bit
    expect(() => decryptSecret(data.toString("base64"))).toThrow();
  });

  it("throws a helpful error when the key is missing", () => {
    delete process.env.PAPERVINE_ENCRYPTION_KEY;
    expect(() => encryptSecret("x")).toThrow(/PAPERVINE_ENCRYPTION_KEY/);
    process.env.PAPERVINE_ENCRYPTION_KEY = KEY;
  });

  it("rejects a key that isn't 32 bytes", () => {
    process.env.PAPERVINE_ENCRYPTION_KEY = Buffer.from("tooshort").toString("base64");
    expect(() => encryptSecret("x")).toThrow(/32 bytes/);
    process.env.PAPERVINE_ENCRYPTION_KEY = KEY;
  });
});
