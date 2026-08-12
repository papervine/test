import { describe, it, expect } from "vitest";
import { parseCustomDomain } from "@/lib/custom-domain";
import { domains } from "@/lib/tenant-host";

describe("parseCustomDomain", () => {
  it("normalizes scheme, case, path, port and trailing dot to a bare host", () => {
    expect(parseCustomDomain("docs.example.com")).toEqual({
      ok: true,
      domain: "docs.example.com",
      requiresOperator: false,
    });
    expect(parseCustomDomain("https://Docs.Example.com/guides/intro")).toEqual({
      ok: true,
      domain: "docs.example.com",
      requiresOperator: false,
    });
    expect(parseCustomDomain("  http://docs.example.com:443/  ")).toEqual({
      ok: true,
      domain: "docs.example.com",
      requiresOperator: false,
    });
    expect(parseCustomDomain("docs.example.com.")).toEqual({
      ok: true,
      domain: "docs.example.com",
      requiresOperator: false,
    });
  });

  it("rejects empty / malformed input", () => {
    expect(parseCustomDomain("").ok).toBe(false);
    expect(parseCustomDomain("   ").ok).toBe(false);
    expect(parseCustomDomain("not a domain").ok).toBe(false);
    expect(parseCustomDomain("acme").ok).toBe(false); // single label, not fully-qualified
    expect(parseCustomDomain("-bad.example.com").ok).toBe(false); // leading hyphen
  });

  it("refuses hosts that are structurally ours", () => {
    expect(parseCustomDomain(domains.platform).ok).toBe(false); // the apex itself
    expect(parseCustomDomain(`app.${domains.platform}`).ok).toBe(false); // control plane
    expect(parseCustomDomain(`www.${domains.platform}`).ok).toBe(false);
    expect(parseCustomDomain(`api.${domains.platform}`).ok).toBe(false);
    expect(parseCustomDomain(domains.tenant).ok).toBe(false); // tenant apex
    expect(parseCustomDomain(`acme.${domains.tenant}`).ok).toBe(false); // a tenant subdomain
    expect(parseCustomDomain("acme.localhost").ok).toBe(false);
    expect(parseCustomDomain("foo.vercel.app").ok).toBe(false);
  });

  it("allows a host on our own domain, flagged as operator-only", () => {
    // The org that owns the platform domain can legitimately point `docs.{platform}` at one
    // of its own sites — that's the custom-domain feature, not an exception to it. A blanket
    // ban on the platform domain is what blocked dogfooding our own docs. Authorization is
    // the server action's job; parsing only reports that it's required.
    expect(parseCustomDomain(`docs.${domains.platform}`)).toEqual({
      ok: true,
      domain: `docs.${domains.platform}`,
      requiresOperator: true,
    });
    // A third party's domain never needs the operator.
    expect(parseCustomDomain("docs.acme.com")).toEqual({
      ok: true,
      domain: "docs.acme.com",
      requiresOperator: false,
    });
  });
});
