import { describe, it, expect } from "vitest";
import {
  validateAuthConfig,
  isAuthMethod,
  AUTH_METHODS,
  AUTH_METHOD_META,
} from "@/lib/reader-auth";

describe("isAuthMethod", () => {
  it("accepts the three spec methods, rejects everything else", () => {
    for (const m of AUTH_METHODS) expect(isAuthMethod(m)).toBe(true);
    expect(isAuthMethod("saml")).toBe(false);
    expect(isAuthMethod("")).toBe(false);
    expect(isAuthMethod(undefined)).toBe(false);
    expect(isAuthMethod(null)).toBe(false);
  });
});

describe("AUTH_METHOD_META", () => {
  // The site Overview surfaces `AUTH_METHOD_META[method].label` in its
  // "Authentication · <method>" badge — pin the labels so a rename can't
  // silently blank that out.
  it("labels every method the dashboard badge can show", () => {
    for (const m of AUTH_METHODS) expect(AUTH_METHOD_META[m].label).toBeTruthy();
    expect(AUTH_METHOD_META.jwt.label).toBe("JWT");
    expect(AUTH_METHOD_META.oauth.label).toBe("OAuth 2.0");
    expect(AUTH_METHOD_META.password.label).toBe("Password");
  });
});

describe("validateAuthConfig — jwt", () => {
  it("requires an https login URL and trims it", () => {
    const res = validateAuthConfig("jwt", { loginUrl: "  https://app.acme.com/login  " });
    expect(res).toEqual({
      ok: true,
      config: { loginUrl: "https://app.acme.com/login" },
      secret: null,
    });
  });

  it("rejects missing / non-https / malformed login URLs", () => {
    expect(validateAuthConfig("jwt", { loginUrl: "" }).ok).toBe(false);
    expect(validateAuthConfig("jwt", { loginUrl: "http://app.acme.com" }).ok).toBe(false);
    expect(validateAuthConfig("jwt", { loginUrl: "not a url" }).ok).toBe(false);
  });

  it("passes a non-empty secret through, treats blank as 'keep current'", () => {
    expect(validateAuthConfig("jwt", { loginUrl: "https://a.co", secret: "" }))
      .toMatchObject({ secret: null });
    expect(validateAuthConfig("jwt", { loginUrl: "https://a.co", secret: "x" }))
      .toMatchObject({ secret: "x" });
  });
});

describe("validateAuthConfig — oauth", () => {
  const valid = {
    authorizationUrl: "https://auth.acme.com/authorize",
    tokenUrl: "https://auth.acme.com/token",
    userInfoUrl: "https://auth.acme.com/userinfo",
    clientId: "acme-docs",
    scopes: "openid profile",
  };

  it("accepts a complete config and normalizes optional empty scopes to undefined", () => {
    const res = validateAuthConfig("oauth", valid);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.config.clientId).toBe("acme-docs");
      expect(res.config.scopes).toBe("openid profile");
    }
    const noScopes = validateAuthConfig("oauth", { ...valid, scopes: "  " });
    expect(noScopes.ok).toBe(true);
    if (noScopes.ok) expect(noScopes.config.scopes).toBeUndefined();
  });

  it("requires every endpoint to be https and a client id", () => {
    expect(validateAuthConfig("oauth", { ...valid, tokenUrl: "" }).ok).toBe(false);
    expect(validateAuthConfig("oauth", { ...valid, userInfoUrl: "http://x.co" }).ok).toBe(false);
    expect(validateAuthConfig("oauth", { ...valid, clientId: "  " }).ok).toBe(false);
  });
});

describe("validateAuthConfig — password", () => {
  it("requires at least 8 characters", () => {
    expect(validateAuthConfig("password", { secret: "short" }).ok).toBe(false);
    const res = validateAuthConfig("password", { secret: "longenough" });
    expect(res).toEqual({ ok: true, config: {}, secret: "longenough" });
  });
});
