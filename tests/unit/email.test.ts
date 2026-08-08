import { describe, it, expect } from "vitest";
import { emailStatus } from "@/lib/email";
import {
  invitationBody,
  resetPasswordBody,
  verifyEmailBody,
} from "@/lib/email-templates";
import { appOriginFor } from "@/lib/tenant-host";

// `allowConsole` mirrors `NODE_ENV !== "production"` at the call site.
const PROD = false;
const DEV = true;

describe("emailStatus", () => {
  it("uses Resend when a key and a sender identity are both present", () => {
    for (const allowConsole of [PROD, DEV]) {
      expect(emailStatus("re_123", "Papervine <hi@papervine.io>", allowConsole)).toEqual({
        enabled: true,
        transport: "resend",
        config: { apiKey: "re_123", from: "Papervine <hi@papervine.io>" },
      });
    }
  });

  it("falls back to the console transport outside production, so the flows stay usable", () => {
    // This is what makes /forgot-password work on a dev machine and in e2e with no vendor
    // account — the link is written to the server log instead of sent.
    expect(emailStatus(undefined, undefined, DEV)).toEqual({
      enabled: true,
      transport: "console",
    });
    expect(emailStatus("   ", "  ", DEV).enabled).toBe(true);
  });

  it("is genuinely OFF in production with no provider", () => {
    // Promising "check your inbox" for a message that only reaches a log file lies to a real
    // user, so production degrades to "reset unavailable" instead.
    expect(emailStatus(undefined, "hi@papervine.io", PROD)).toEqual({
      enabled: false,
      reason: "unconfigured",
    });
  });

  it("distinguishes a half-configured provider in production", () => {
    // Resend rejects a send whose `from` isn't on a verified domain, so this would fail at
    // send time rather than at boot — its own reason so the warning can say why.
    expect(emailStatus("re_123", undefined, PROD)).toEqual({
      enabled: false,
      reason: "missing-from",
    });
  });
});

describe("appOriginFor", () => {
  it("maps the configured apex origin to the control-plane host", () => {
    expect(appOriginFor("https://papervine.io")).toBe("https://app.papervine.io");
    expect(appOriginFor("http://localhost:3000")).toBe("http://app.localhost:3000");
  });

  it("is idempotent when BETTER_AUTH_URL already names the app host", () => {
    expect(appOriginFor("https://app.papervine.io")).toBe("https://app.papervine.io");
  });

  it("returns null instead of throwing on a missing/typo'd value", () => {
    // The auth config builds emailed links from this at import time — a bad env var must
    // degrade to "no email links" with a warning, not crash the server on boot.
    expect(appOriginFor("")).toBeNull();
    expect(appOriginFor("papervine.io")).toBeNull();
  });
});

describe("email templates", () => {
  const URL_ = "https://app.papervine.io/api/auth/verify-email?token=abc";

  it("puts the link in both the HTML and the plaintext part", () => {
    // A missing text/plain alternative is itself a spam signal, and some clients render
    // nothing else — so every template owes both.
    for (const body of [
      verifyEmailBody({ url: URL_, name: "Ada" }),
      resetPasswordBody({ url: URL_, name: "Ada", expiresInMinutes: 60 }),
      invitationBody({ url: URL_, organization: "Acme", role: "admin", inviterName: "Ada" }),
    ]) {
      expect(body.subject.length).toBeGreaterThan(0);
      expect(body.html).toContain(URL_);
      expect(body.text).toContain(URL_);
    }
  });

  it("escapes user-controlled values into the HTML part", () => {
    // A display name / org name is whatever someone typed at signup. Unescaped, it would
    // inject markup into mail we send on their behalf.
    const body = invitationBody({
      url: URL_,
      organization: '<script>alert("x")</script>',
      role: "member",
      inviterName: "<b>Ada</b>",
    });
    expect(body.html).not.toContain("<script>");
    expect(body.html).toContain("&lt;script&gt;");
    expect(body.html).not.toContain("<b>Ada</b>");
  });

  it("tells the reader how long a reset link lasts", () => {
    expect(resetPasswordBody({ url: URL_, expiresInMinutes: 60 }).text).toContain("60 minutes");
  });

  it("works without a name (social signups may not have one)", () => {
    const body = verifyEmailBody({ url: URL_, name: null });
    expect(body.text).toContain("Hi,");
    expect(body.html).toContain(URL_);
  });
});
