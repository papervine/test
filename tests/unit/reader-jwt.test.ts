import { describe, it, expect } from "vitest";
import { SignJWT, importPKCS8 } from "jose";
import {
  generateEd25519Keypair,
  verifyReaderJwt,
  signReaderJwtForTest,
} from "@/lib/reader-jwt";
import { customerLoginUrl } from "@/lib/reader-auth";

const HOST = "docs.example.com";

describe("reader JWT handshake (EdDSA / Ed25519)", () => {
  it("round-trips a token signed with the private key", async () => {
    const { privateKeyPem, publicKeyPem } = await generateEd25519Keypair();
    const token = await signReaderJwtForTest(privateKeyPem, {
      host: HOST,
      groups: ["admin", "beta"],
      expiresAt: 1_900_000_000,
    });
    const res = await verifyReaderJwt(token, publicKeyPem, HOST);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.user.host).toBe(HOST);
      expect(res.user.groups).toEqual(["admin", "beta"]);
      expect(res.user.expiresAt).toBe(1_900_000_000);
    }
  });

  it("generates PEM-encoded keys", async () => {
    const { privateKeyPem, publicKeyPem } = await generateEd25519Keypair();
    expect(privateKeyPem).toMatch(/^-----BEGIN PRIVATE KEY-----/);
    expect(publicKeyPem).toMatch(/^-----BEGIN PUBLIC KEY-----/);
  });

  it("rejects a token whose host claim doesn't match the docs domain (anti-replay)", async () => {
    const { privateKeyPem, publicKeyPem } = await generateEd25519Keypair();
    const token = await signReaderJwtForTest(privateKeyPem, { host: "evil.com" });
    const res = await verifyReaderJwt(token, publicKeyPem, HOST);
    expect(res.ok).toBe(false);
  });

  it("rejects a token missing the host claim", async () => {
    const { privateKeyPem, publicKeyPem } = await generateEd25519Keypair();
    const token = await signReaderJwtForTest(privateKeyPem, { groups: ["x"] });
    const res = await verifyReaderJwt(token, publicKeyPem, HOST);
    expect(res.ok).toBe(false);
  });

  it("rejects an expired token", async () => {
    const { privateKeyPem, publicKeyPem } = await generateEd25519Keypair();
    // exp already in the past relative to the injected `now`.
    const key = await importPKCS8(privateKeyPem, "EdDSA");
    const token = await new SignJWT({ host: HOST })
      .setProtectedHeader({ alg: "EdDSA" })
      .setExpirationTime(Math.floor(Date.now() / 1000) - 10)
      .sign(key);
    const res = await verifyReaderJwt(token, publicKeyPem, HOST);
    expect(res.ok).toBe(false);
  });

  it("rejects a token signed by a different keypair (wrong public key)", async () => {
    const a = await generateEd25519Keypair();
    const b = await generateEd25519Keypair();
    const token = await signReaderJwtForTest(a.privateKeyPem, { host: HOST });
    const res = await verifyReaderJwt(token, b.publicKeyPem, HOST);
    expect(res.ok).toBe(false);
  });

  it("rejects a symmetric (HS256) token — algorithm confusion is pinned out", async () => {
    const { publicKeyPem } = await generateEd25519Keypair();
    // Sign with HS256 using the raw public-key bytes as the HMAC secret — the classic
    // alg-confusion attack. verifyReaderJwt must refuse because it only accepts EdDSA.
    const secret = new TextEncoder().encode(publicKeyPem);
    const token = await new SignJWT({ host: HOST })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("10s")
      .sign(secret);
    const res = await verifyReaderJwt(token, publicKeyPem, HOST);
    expect(res.ok).toBe(false);
  });

  it("rejects a tampered token", async () => {
    const { privateKeyPem, publicKeyPem } = await generateEd25519Keypair();
    const token = await signReaderJwtForTest(privateKeyPem, { host: HOST });
    // Flip a character in the payload segment.
    const parts = token.split(".");
    parts[1] = parts[1].slice(0, -1) + (parts[1].endsWith("A") ? "B" : "A");
    const res = await verifyReaderJwt(parts.join("."), publicKeyPem, HOST);
    expect(res.ok).toBe(false);
  });

  it("fails closed on a malformed public key", async () => {
    const { privateKeyPem } = await generateEd25519Keypair();
    const token = await signReaderJwtForTest(privateKeyPem, { host: HOST });
    const res = await verifyReaderJwt(token, "not-a-pem", HOST);
    expect(res.ok).toBe(false);
  });
});

describe("customerLoginUrl", () => {
  it("appends the intended path as ?redirect=", () => {
    expect(customerLoginUrl("https://app.example.com/login", "/guides/intro")).toBe(
      "https://app.example.com/login?redirect=%2Fguides%2Fintro",
    );
  });

  it("preserves an existing query on the login URL", () => {
    const out = customerLoginUrl("https://app.example.com/login?source=docs", "/");
    expect(out).toContain("source=docs");
    expect(out).toContain("redirect=%2F");
  });
});
