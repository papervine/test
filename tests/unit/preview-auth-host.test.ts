import { describe, it, expect } from "vitest";
import { hasAppSubdomain, appHostFor, isReservedPlatformHost } from "../../src/lib/tenant-host";
import { deploymentOrigin } from "../../src/lib/env";

// Signing in on a Vercel PREVIEW (2026-09-03). Two independent reasons it couldn't work,
// both pinned here because both are invisible until someone actually tries it — and
// previews are rarely signed into.

describe("hasAppSubdomain", () => {
  it("is false for a Vercel preview, whose app. sibling cannot exist", () => {
    // appHostFor happily produces the name; Vercel never creates it and its wildcard
    // certificate does not cover a nested label, so the browser hits a dead host.
    const preview = "papervine-git-cursor-fix-1c53b3-jeff-loiselles-projects.vercel.app";
    expect(appHostFor(preview)).toBe(`app.${preview}`); // the name we WOULD have sent them to
    expect(hasAppSubdomain(preview)).toBe(false);
  });

  it("is false for a raw IP, which has no subdomains at all", () => {
    expect(hasAppSubdomain("127.0.0.1")).toBe(false);
    expect(hasAppSubdomain("127.0.0.1:3000")).toBe(false);
  });

  it("stays true where the bounce genuinely works", () => {
    // localhost is load-bearing: app.localhost resolves, and dev depends on the bounce.
    expect(hasAppSubdomain("localhost:3000")).toBe(true);
    expect(hasAppSubdomain("papervine.io")).toBe(true);
    expect(hasAppSubdomain("www.papervine.io")).toBe(true);
    expect(hasAppSubdomain("app.papervine.io")).toBe(true);
  });

  it("does not change which hosts are reserved — only whether they bounce", () => {
    // The preview is still ours (it must never be treated as a claimable vanity domain);
    // the new predicate answers a different question about the same host.
    const preview = "papervine-git-branch-team.vercel.app";
    expect(isReservedPlatformHost(preview)).toBe(true);
    expect(hasAppSubdomain(preview)).toBe(false);
  });
});

describe("deploymentOrigin", () => {
  it("prefers BETTER_AUTH_URL — only the operator knows the stable public host", () => {
    // On Vercel prod, VERCEL_URL is the deployment-specific name, NOT the domain anyone
    // visits, so an explicit value has to win.
    expect(
      deploymentOrigin({
        NODE_ENV: "production",
        BETTER_AUTH_URL: "https://app.papervine.io",
        VERCEL_URL: "papervine-abc123.vercel.app",
      }),
    ).toBe("https://app.papervine.io");
  });

  it("falls back to the per-deployment VERCEL_URL, which is what makes previews work", () => {
    // A preview hostname is generated, so no static value can name it — and a value
    // copied from production names an origin the visitor is not on, which Better Auth
    // rejects as foreign.
    expect(
      deploymentOrigin({
        NODE_ENV: "production",
        VERCEL_URL: "papervine-git-branch-team.vercel.app",
      }),
    ).toBe("https://papervine-git-branch-team.vercel.app");
  });

  it("tolerates a VERCEL_URL that already carries a scheme", () => {
    expect(
      deploymentOrigin({ NODE_ENV: "production", VERCEL_URL: "https://preview.vercel.app" }),
    ).toBe("https://preview.vercel.app");
  });

  it("ignores blank values rather than producing a bare https://", () => {
    expect(
      deploymentOrigin({ NODE_ENV: "production", BETTER_AUTH_URL: "   ", VERCEL_URL: "" }),
    ).toBe(undefined);
  });

  it("is undefined with neither — callers warn rather than crash", () => {
    expect(deploymentOrigin({ NODE_ENV: "production" })).toBe(undefined);
  });
});
