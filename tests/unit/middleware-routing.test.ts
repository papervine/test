import { describe, it, expect, beforeAll } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
import { domains } from "@/lib/tenant-host";

// The control-plane auth-path bounce (apex `/login` → app host) must NOT hijack a tenant
// subdomain's `/login`, which is the *reader* login (SPEC §11.2). Regression for the bug
// where `isPlatformHost` (true for `{slug}.localhost` too) bounced `starter.localhost/login`
// to `app.starter.localhost/login` (the Papervine account login), so reader auth never
// reached its own card in subdomain mode. Lives here, not in smoke: the smoke server runs
// in single-repo preview mode (PAPERVINE_CONTENT set), which disables this very bounce.

function req(host: string, path: string): NextRequest {
  return new NextRequest(`http://${host}${path}`, { headers: { host } });
}

describe("middleware host routing", () => {
  beforeAll(() => {
    // The bounce only runs outside single-repo preview mode.
    delete process.env.PAPERVINE_CONTENT;
  });

  it("rewrites a tenant subdomain /login to the reader login card, not the app host", () => {
    const res = middleware(req("starter.localhost:3000", "/login"));
    // A rewrite (not a redirect): the reader login route is served in place.
    expect(res.headers.get("x-middleware-rewrite")).toContain("/sites/starter/login");
    // Crucially, it must NOT bounce to the control-plane host.
    expect(res.headers.get("location") ?? "").not.toContain("app.starter.localhost");
  });

  it("rewrites tenant subdomain docs to /sites/{slug}", () => {
    const res = middleware(req("starter.localhost:3000", "/quickstart"));
    expect(res.headers.get("x-middleware-rewrite")).toContain("/sites/starter/quickstart");
  });

  it("serves tenant docs on the tenant domain", () => {
    const res = middleware(req(`starter.${domains.tenant}`, "/quickstart"));
    expect(res.headers.get("x-middleware-rewrite")).toContain("/sites/starter/quickstart");
  });

  it("permanently redirects a legacy tenant host to the tenant domain, keeping the path", () => {
    // Old links (bookmarks, READMEs, search results) must survive the domain move.
    const res = middleware(req(`starter.${domains.platform}`, "/guides/setup?x=1"));
    expect(res.status).toBe(308);
    const loc = res.headers.get("location") ?? "";
    expect(loc).toContain(`starter.${domains.tenant}`);
    expect(loc).toContain("/guides/setup");
    expect(loc).toContain("x=1");
  });

  it("does not redirect the platform's own hosts", () => {
    // `app.` is the control plane, not a tenant called "app".
    const res = middleware(req(`app.${domains.platform}`, "/"));
    expect(res.status).not.toBe(308);
  });

  it("still bounces apex /login to the app host (control-plane auth path)", () => {
    const res = middleware(req("localhost:3000", "/login"));
    const loc = res.headers.get("location") ?? "";
    expect(loc).toContain("app.localhost:3000");
    expect(loc).toContain("/login");
  });

  it("forwards an apex OAuth callback to the app host with its query intact", () => {
    // Google's redirect URI is registered on the apex (it rejects one on a subdomain of
    // localhost), but the PKCE/state cookies are host-only on `app.` — so the callback must
    // be REDIRECTED there, carrying ?code/?state, or the code exchange always fails.
    const res = middleware(
      req("localhost:3000", "/api/auth/callback/google?code=abc&state=xyz"),
    );
    const loc = new URL(res.headers.get("location") ?? "http://none/");
    expect(loc.host).toBe("app.localhost:3000");
    expect(loc.pathname).toBe("/api/auth/callback/google");
    expect(loc.searchParams.get("code")).toBe("abc");
    expect(loc.searchParams.get("state")).toBe("xyz");
  });

  it("does not hijack a tenant subdomain's /api/auth path", () => {
    // Tenant hosts serve reader auth, not the control plane — their /api/* must pass
    // through untouched (the same guard that keeps /login from being bounced).
    const res = middleware(
      req("starter.localhost:3000", "/api/auth/callback/google?code=abc"),
    );
    expect(res.headers.get("location")).toBeNull();
  });
});

// A signed-in request (session cookie present) on the app host. Better Auth's
// getSessionCookie only checks presence at the edge, so any value works here.
function authedReq(path: string): NextRequest {
  const host = "app.localhost:3000";
  return new NextRequest(`http://${host}${path}`, {
    headers: { host, cookie: "better-auth.session_token=e2e-fake" },
  });
}

describe("app-host auth-path bounce (signed in)", () => {
  it("does NOT bounce /onboarding — org-less users are sent here by the resolver", () => {
    // Regression: bouncing authed users off /onboarding to "/" looped with the
    // dashboard resolver's org-less → /onboarding redirect (ERR_TOO_MANY_REDIRECTS
    // on every fresh signup).
    const res = middleware(authedReq("/onboarding"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("bounces /login and /signup to the dashboard", () => {
    for (const path of ["/login", "/signup"]) {
      const loc = middleware(authedReq(path)).headers.get("location") ?? "";
      expect(loc).toContain("app.localhost:3000");
      expect(new URL(loc).pathname).toBe("/");
    }
  });

  it("does NOT bounce the password-reset pages — they're reached from an emailed link", () => {
    // Someone clicking a reset link very often still holds a live session (shared machine, a
    // suspected compromise). Bouncing them to the dashboard makes the link useless to exactly
    // the people who need it.
    for (const path of ["/forgot-password", "/reset-password?token=abc"]) {
      expect(middleware(authedReq(path)).headers.get("location")).toBeNull();
    }
  });
});

describe("apex bounce for the password pages", () => {
  it("sends apex /forgot-password and /reset-password to the app host", () => {
    // They're control-plane auth pages like /login: the session they'd create belongs on the
    // app host, so the apex must hand them over rather than render them.
    for (const path of ["/forgot-password", "/reset-password"]) {
      const loc = middleware(req("localhost:3000", path)).headers.get("location") ?? "";
      expect(loc).toContain("app.localhost:3000");
      expect(new URL(loc).pathname).toBe(path);
    }
  });
});
