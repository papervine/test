import { describe, it, expect } from "vitest";
import { normalizeOrigin, isOriginAllowed } from "@/lib/widget";

describe("normalizeOrigin", () => {
  it("accepts a plain https origin unchanged", () => {
    expect(normalizeOrigin("https://docs.example.com")).toBe("https://docs.example.com");
  });

  it("accepts http and non-default ports", () => {
    expect(normalizeOrigin("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("lowercases the host", () => {
    expect(normalizeOrigin("https://Docs.Example.COM")).toBe("https://docs.example.com");
  });

  it("strips a default port", () => {
    expect(normalizeOrigin("https://docs.example.com:443")).toBe("https://docs.example.com");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeOrigin("  https://docs.example.com  ")).toBe("https://docs.example.com");
  });

  it("rejects a path", () => {
    expect(normalizeOrigin("https://docs.example.com/support")).toBeNull();
  });

  it("rejects a query string", () => {
    expect(normalizeOrigin("https://docs.example.com?x=1")).toBeNull();
  });

  it("rejects a hash", () => {
    expect(normalizeOrigin("https://docs.example.com#section")).toBeNull();
  });

  it("rejects a wildcard host", () => {
    expect(normalizeOrigin("https://*.example.com")).toBeNull();
  });

  it("rejects a non-http(s) scheme", () => {
    expect(normalizeOrigin("ftp://example.com")).toBeNull();
  });

  it("rejects garbage input", () => {
    expect(normalizeOrigin("not a url")).toBeNull();
  });

  it("rejects an empty string", () => {
    expect(normalizeOrigin("   ")).toBeNull();
  });
});

describe("isOriginAllowed", () => {
  const allowed = ["https://docs.example.com", "http://localhost:3000"];

  it("allows an exact match", () => {
    expect(isOriginAllowed("https://docs.example.com", allowed)).toBe(true);
  });

  it("rejects a missing Origin header", () => {
    expect(isOriginAllowed(null, allowed)).toBe(false);
  });

  it("rejects an origin not in the list", () => {
    expect(isOriginAllowed("https://evil.example", allowed)).toBe(false);
  });

  it("rejects a scheme mismatch against an otherwise-matching host", () => {
    expect(isOriginAllowed("http://docs.example.com", allowed)).toBe(false);
  });

  it("rejects everything when the list is empty", () => {
    expect(isOriginAllowed("https://docs.example.com", [])).toBe(false);
  });
});
