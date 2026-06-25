import { describe, it, expect, beforeAll } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

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

  it("still bounces apex /login to the app host (control-plane auth path)", () => {
    const res = middleware(req("localhost:3000", "/login"));
    const loc = res.headers.get("location") ?? "";
    expect(loc).toContain("app.localhost:3000");
    expect(loc).toContain("/login");
  });
});
