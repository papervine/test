import { describe, expect, it } from "vitest";
import { postAuthDestFor } from "@/app/(auth)/post-auth-dest";

/**
 * Where the auth pages send someone after a successful sign-in.
 *
 * The OAuth case is the one worth pinning: Better Auth's `mcp` plugin bounces an
 * unauthenticated `/api/auth/mcp/authorize` to `/login?<the whole authorize query>` and expects
 * the app to come back once there's a session (SPEC §9.2/§11). If this returns "/" instead, the
 * user lands on the dashboard, the MCP client that sent them is still waiting, and the only
 * recovery is to start the flow again — a dead end that looks like the client's fault.
 */
describe("postAuthDestFor", () => {
  it("resumes an OAuth authorization, query intact", () => {
    const search =
      "?response_type=code&client_id=abc123&redirect_uri=http%3A%2F%2F127.0.0.1%3A9999%2Fcb&code_challenge=xyz&code_challenge_method=S256";
    const dest = postAuthDestFor(search);

    expect(dest.startsWith("/api/auth/mcp/authorize?")).toBe(true);
    // Every parameter has to survive: the plugin re-reads the whole query, and a dropped
    // code_challenge turns a PKCE flow into one the token endpoint rejects.
    const forwarded = new URLSearchParams(dest.split("?")[1]);
    for (const [key, value] of new URLSearchParams(search)) {
      expect(forwarded.get(key), key).toBe(value);
    }
  });

  it("stays relative, so it resolves against the host the user is actually on", () => {
    // An absolute URL built from configuration is what sent a dev user from :3001 to a
    // different application on :3000 mid-flow.
    const dest = postAuthDestFor("?response_type=code&client_id=abc");
    expect(dest.startsWith("/")).toBe(true);
    expect(dest).not.toMatch(/^https?:/);
  });

  it("needs both OAuth markers, not just one", () => {
    // `client_id` alone could plausibly appear on some other flow; the pair is what identifies
    // an authorize round trip.
    expect(postAuthDestFor("?client_id=abc")).toBe("/");
    expect(postAuthDestFor("?response_type=code")).toBe("/");
  });

  it("prefers a resumable authorization over a pending invite", () => {
    // Both can be present if someone was invited and then started an authorization. The
    // authorization is the flow with something waiting on the other end.
    const dest = postAuthDestFor("?invite=inv_1&client_id=abc&response_type=code");
    expect(dest.startsWith("/api/auth/mcp/authorize?")).toBe(true);
  });

  it("still honors a pending invite", () => {
    expect(postAuthDestFor("?invite=inv_1")).toBe("/accept-invite?id=inv_1");
  });

  it("defaults to the dashboard", () => {
    expect(postAuthDestFor("")).toBe("/");
    expect(postAuthDestFor("?email=someone%40example.com")).toBe("/");
  });
});
