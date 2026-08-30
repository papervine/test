import { describe, it, expect } from "vitest";
import {
  githubOAuthStatus,
  googleOAuthStatus,
  isOAuthCallbackPath,
  oauthCallbackURI,
  oauthErrorMessage,
} from "@/lib/social-auth";

const APEX = "https://papervine.io";

describe("googleOAuthStatus", () => {
  it("enables Google when both credentials and an origin are present", () => {
    expect(
      googleOAuthStatus("cid.apps.googleusercontent.com", "secret", APEX),
    ).toEqual({
      enabled: true,
      config: {
        clientId: "cid.apps.googleusercontent.com",
        clientSecret: "secret",
        redirectURI: "https://papervine.io/api/auth/callback/google",
      },
    });
  });

  it("stays off when credentials are absent — the normal state for a bare checkout/CI", () => {
    expect(googleOAuthStatus(undefined, undefined, APEX)).toEqual({
      enabled: false,
      reason: "unconfigured",
    });
  });

  it("treats a half-finished credential pair as unconfigured, not enabled", () => {
    const halves: Array<[string | undefined, string | undefined]> = [
      ["cid", undefined],
      [undefined, "secret"],
      // Blank/whitespace values are how a bare `GOOGLE_CLIENT_SECRET=` line in .env reads.
      ["cid", "   "],
    ];
    for (const [id, secret] of halves) {
      expect(googleOAuthStatus(id, secret, APEX).enabled).toBe(false);
    }
  });

  it("reports the misconfiguration when credentials exist but no origin does", () => {
    expect(googleOAuthStatus("cid", "secret", undefined)).toEqual({
      enabled: false,
      reason: "missing-base-url",
    });
  });
});

describe("githubOAuthStatus", () => {
  it("enables GitHub from the App's user-OAuth credential, with the github callback", () => {
    expect(githubOAuthStatus("Iv1.abc123", "secret", APEX)).toEqual({
      enabled: true,
      config: {
        clientId: "Iv1.abc123",
        clientSecret: "secret",
        redirectURI: "https://papervine.io/api/auth/callback/github",
      },
    });
  });

  it("shares Google's off states: unconfigured halves, and credentials with no origin", () => {
    expect(githubOAuthStatus(undefined, undefined, APEX)).toEqual({
      enabled: false,
      reason: "unconfigured",
    });
    expect(githubOAuthStatus("Iv1.abc123", "  ", APEX).enabled).toBe(false);
    expect(githubOAuthStatus("Iv1.abc123", "secret", undefined)).toEqual({
      enabled: false,
      reason: "missing-base-url",
    });
  });
});

describe("oauthCallbackURI", () => {
  it("builds the URI on the apex origin — the one registered with the provider", () => {
    expect(oauthCallbackURI("http://localhost:3000", "google")).toBe(
      "http://localhost:3000/api/auth/callback/google",
    );
  });

  it("tolerates a trailing slash / padding in BETTER_AUTH_URL", () => {
    // A mismatch here is not a warning but a hard `redirect_uri_mismatch` from the
    // provider, so normalize rather than trust the operator's formatting.
    expect(oauthCallbackURI(" https://papervine.io// ", "google")).toBe(
      "https://papervine.io/api/auth/callback/google",
    );
  });
});

describe("isOAuthCallbackPath", () => {
  it("matches any provider's callback (so a new provider needs no middleware change)", () => {
    expect(isOAuthCallbackPath("/api/auth/callback/google")).toBe(true);
    expect(isOAuthCallbackPath("/api/auth/callback/github")).toBe(true);
  });

  it("does not match the rest of the auth API", () => {
    expect(isOAuthCallbackPath("/api/auth/sign-in/social")).toBe(false);
    expect(isOAuthCallbackPath("/api/auth/callback")).toBe(false);
    expect(isOAuthCallbackPath("/login")).toBe(false);
  });
});

describe("oauthErrorMessage", () => {
  it("explains the same-email collision in the user's terms", () => {
    expect(oauthErrorMessage("account_not_linked")).toContain("password");
  });

  it("falls back to a generic message rather than leaking an unknown code", () => {
    // Provider-neutral: the code lands back on the form with nothing saying which button
    // was pressed, so the copy can't name one.
    const msg = oauthErrorMessage("some_internal_code");
    expect(msg).toBe("Sign-in didn't complete. Please try again.");
    expect(msg).not.toContain("some_internal_code");
  });

  it("is null when the page was reached normally", () => {
    expect(oauthErrorMessage(null)).toBeNull();
    expect(oauthErrorMessage("")).toBeNull();
  });
});
