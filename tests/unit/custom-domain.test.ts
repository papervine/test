import { describe, it, expect } from "vitest";
import { parseCustomDomain } from "@/lib/custom-domain";

describe("parseCustomDomain", () => {
  it("normalizes scheme, case, path, port and trailing dot to a bare host", () => {
    expect(parseCustomDomain("docs.example.com")).toEqual({ ok: true, domain: "docs.example.com" });
    expect(parseCustomDomain("https://Docs.Example.com/guides/intro")).toEqual({
      ok: true,
      domain: "docs.example.com",
    });
    expect(parseCustomDomain("  http://docs.example.com:443/  ")).toEqual({
      ok: true,
      domain: "docs.example.com",
    });
    expect(parseCustomDomain("docs.example.com.")).toEqual({ ok: true, domain: "docs.example.com" });
  });

  it("rejects empty / malformed input", () => {
    expect(parseCustomDomain("").ok).toBe(false);
    expect(parseCustomDomain("   ").ok).toBe(false);
    expect(parseCustomDomain("not a domain").ok).toBe(false);
    expect(parseCustomDomain("acme").ok).toBe(false); // single label, not fully-qualified
    expect(parseCustomDomain("-bad.example.com").ok).toBe(false); // leading hyphen
  });

  it("refuses Papervine-owned hosts", () => {
    expect(parseCustomDomain("acme.papervine.io").ok).toBe(false);
    expect(parseCustomDomain("papervine.io").ok).toBe(false);
    expect(parseCustomDomain("acme.localhost").ok).toBe(false);
    expect(parseCustomDomain("foo.vercel.app").ok).toBe(false);
  });
});
