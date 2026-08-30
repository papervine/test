import { describe, it, expect } from "vitest";
import {
  classifyWidgetCaller,
  normalizeOrigin,
  isOriginAllowed,
  resolveDocsBaseUrl,
} from "@/lib/widget";
import { domains } from "@/lib/tenant-host";

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

describe("classifyWidgetCaller", () => {
  const allowed = ["https://docs.example.com"];
  const appOrigin = "https://app.papervine.io";

  it("calls an allowlisted customer origin allowlisted", () => {
    expect(classifyWidgetCaller("https://docs.example.com", allowed, appOrigin)).toBe(
      "allowlisted",
    );
  });

  it("calls our own dashboard origin `dashboard`, NOT allowlisted", () => {
    // The distinction is the whole point: `dashboard` still owes a session check
    // (sessionIsOrgMember) before the request is authorized. Collapsing the two would make
    // the app host an implicit entry in every tenant's allowlist.
    expect(classifyWidgetCaller(appOrigin, allowed, appOrigin)).toBe("dashboard");
  });

  it("prefers `allowlisted` when the owner really did allowlist the app host", () => {
    expect(classifyWidgetCaller(appOrigin, [appOrigin], appOrigin)).toBe("allowlisted");
  });

  it("denies an unrelated origin", () => {
    expect(classifyWidgetCaller("https://evil.example", allowed, appOrigin)).toBe("denied");
  });

  it("denies a missing Origin header", () => {
    expect(classifyWidgetCaller(null, allowed, appOrigin)).toBe("denied");
  });

  it("denies everything but the allowlist when the app origin is unknown", () => {
    // appOriginFor returns null for an unparseable request URL — that must fail closed, not
    // turn a null origin into a match.
    expect(classifyWidgetCaller(appOrigin, allowed, null)).toBe("denied");
    expect(classifyWidgetCaller(null, allowed, null)).toBe("denied");
    expect(classifyWidgetCaller("https://docs.example.com", allowed, null)).toBe("allowlisted");
  });

  it("denies a dashboard-looking origin that isn't the app origin", () => {
    expect(classifyWidgetCaller("https://app.papervine.io.evil.test", allowed, appOrigin)).toBe(
      "denied",
    );
  });
});

describe("resolveDocsBaseUrl", () => {
  // Regression: the widget's citation links were built as if the assistant's own
  // relative "/page" markdown links resolved on the docs site — but the widget renders
  // on an arbitrary customer page, so the client needs this base to rewrite them.
  it("prefers a custom domain over the host-derived URL", () => {
    expect(
      resolveDocsBaseUrl("app.papervine.io", { customDomain: "docs.acme.com", slug: "acme" }),
    ).toBe("https://docs.acme.com");
  });

  it("uses the configured TENANT domain, not the host that served the request", () => {
    // Citations are minted while serving an embed on a customer's page, and the request
    // arrives on the platform/app host. Deriving the docs origin from that host would send
    // readers to the legacy `{slug}.{platform}` domain instead of the canonical tenant one.
    expect(resolveDocsBaseUrl("app.papervine.io", { customDomain: null, slug: "acme" })).toBe(
      `https://acme.${domains.tenant}`,
    );
  });

  it("falls back to apex-path mode on a host without wildcard-subdomain support", () => {
    expect(resolveDocsBaseUrl("app.example.vercel.app", { customDomain: null, slug: "acme" })).toBe(
      "https://example.vercel.app/sites/acme",
    );
  });

  it("lands on the tenant domain from the www. host too", () => {
    expect(resolveDocsBaseUrl("www.papervine.io", { customDomain: null, slug: "acme" })).toBe(
      `https://acme.${domains.tenant}`,
    );
  });

  it("uses http for a localhost host", () => {
    expect(resolveDocsBaseUrl("app.localhost:3000", { customDomain: null, slug: "acme" })).toBe(
      "http://acme.localhost:3000",
    );
  });
});
