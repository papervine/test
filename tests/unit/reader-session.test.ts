import { describe, it, expect, beforeAll } from "vitest";
import {
  mintReaderSession,
  readerSession,
  readerSessionValid,
  passwordMatches,
  READER_SESSION_TTL_S,
} from "@/lib/reader-session";
import { safeRedirect } from "@/lib/reader-auth";

const KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");

describe("reader docs session", () => {
  beforeAll(() => {
    process.env.PAPERVINE_ENCRYPTION_KEY = KEY;
  });

  it("round-trips a valid session for the site it was minted for", () => {
    const cookie = mintReaderSession("site_123");
    expect(readerSessionValid(cookie, "site_123")).toBe(true);
  });

  it("rejects a session minted for a different site (apex path-mode isolation)", () => {
    const cookie = mintReaderSession("site_A");
    expect(readerSessionValid(cookie, "site_B")).toBe(false);
  });

  it("rejects a missing cookie", () => {
    expect(readerSessionValid(undefined, "site_123")).toBe(false);
    expect(readerSessionValid("", "site_123")).toBe(false);
  });

  it("rejects an expired session", () => {
    const t0 = 1_000_000_000_000;
    const cookie = mintReaderSession("site_123", t0);
    const afterExpiry = t0 + READER_SESSION_TTL_S * 1000 + 1;
    expect(readerSessionValid(cookie, "site_123", t0 + 1000)).toBe(true);
    expect(readerSessionValid(cookie, "site_123", afterExpiry)).toBe(false);
  });

  it("rejects a forged/tampered cookie", () => {
    const cookie = mintReaderSession("site_123");
    const data = Buffer.from(cookie, "base64");
    data[data.length - 1] ^= 0xff;
    expect(readerSessionValid(data.toString("base64"), "site_123")).toBe(false);
    expect(readerSessionValid("not-even-base64-$$$", "site_123")).toBe(false);
  });

  it("readerSession returns the groups claim for the page gate", () => {
    const cookie = mintReaderSession("site_123", Date.now(), { groups: ["admin", "beta"] });
    expect(readerSession(cookie, "site_123")?.groups).toEqual(["admin", "beta"]);
    // Same site-binding + expiry rules as readerSessionValid → null otherwise.
    expect(readerSession(cookie, "site_OTHER")).toBeNull();
    expect(readerSession(undefined, "site_123")).toBeNull();
  });

  it("readerSession omits groups for the password method (no per-user identity)", () => {
    const cookie = mintReaderSession("site_123");
    expect(readerSession(cookie, "site_123")?.groups).toBeUndefined();
  });
});

describe("passwordMatches (constant-time)", () => {
  it("matches the exact password and rejects anything else", () => {
    expect(passwordMatches("hunter2hunter2", "hunter2hunter2")).toBe(true);
    expect(passwordMatches("hunter2hunter2", "hunter2hunter3")).toBe(false);
    expect(passwordMatches("", "hunter2hunter2")).toBe(false);
    expect(passwordMatches("short", "a-much-longer-password")).toBe(false);
  });
});

describe("safeRedirect (open-redirect guard)", () => {
  it("allows same-site relative paths", () => {
    expect(safeRedirect("/guides/intro", "/")).toBe("/guides/intro");
    expect(safeRedirect("/sites/acme/", "/")).toBe("/sites/acme/");
  });

  it("falls back on protocol-relative or absolute URLs and empties", () => {
    expect(safeRedirect("//evil.com", "/")).toBe("/");
    expect(safeRedirect("https://evil.com", "/")).toBe("/");
    expect(safeRedirect("javascript:alert(1)", "/")).toBe("/");
    expect(safeRedirect(undefined, "/home")).toBe("/home");
    expect(safeRedirect("", "/home")).toBe("/home");
  });
});
