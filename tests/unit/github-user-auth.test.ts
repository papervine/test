import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { encryptSecret } from "../../src/lib/crypto";

// GitHub App user-to-server auth + the `state` that survives the round trip to github.com.
//
// The state format is shared by BOTH flows on purpose: an App has one Callback URL, and with
// user-authorization-on-install enabled GitHub uses it for the install too. Two shapes meant
// an install arrived carrying a state the create-repo decoder rejected, and the route bailed
// to `/` with the installation never recorded. `repo` present = also create a repository.
const ORIGINAL = { ...process.env };

beforeEach(() => {
  process.env.GITHUB_APP_CLIENT_ID = "Iv23li.testclientid";
  process.env.GITHUB_APP_CLIENT_SECRET = "testsecret";
  process.env.PAPERVINE_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.useRealTimers();
});

describe("isUserAuthConfigured", () => {
  it("is true only when both client credentials are present", async () => {
    const m = await import("../../src/lib/github-user-auth");
    expect(m.isUserAuthConfigured()).toBe(true);
    delete process.env.GITHUB_APP_CLIENT_SECRET;
    expect(m.isUserAuthConfigured()).toBe(false);
    delete process.env.GITHUB_APP_CLIENT_ID;
    expect(m.isUserAuthConfigured()).toBe(false);
  });
});

describe("userAuthorizeUrl", () => {
  it("points at the App's own user-authorization endpoint, carrying the state", async () => {
    const { userAuthorizeUrl } = await import("../../src/lib/github-user-auth");
    const url = new URL(userAuthorizeUrl("opaque-state")!);
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("Iv23li.testclientid");
    expect(url.searchParams.get("state")).toBe("opaque-state");
  });

  it("is null when the deployment can't create repos", async () => {
    delete process.env.GITHUB_APP_CLIENT_ID;
    const { userAuthorizeUrl } = await import("../../src/lib/github-user-auth");
    expect(userAuthorizeUrl("s")).toBeNull();
  });
});

describe("github flow state", () => {
  it("round-trips an install intent (no repo) — the Install App button", async () => {
    const m = await import("../../src/lib/github-user-auth");
    const decoded = m.decodeGithubFlowState(
      m.encodeGithubFlowState({ org: "acme", site: "docs" }),
    );
    expect(decoded).toMatchObject({ org: "acme", site: "docs" });
    expect(decoded?.repo).toBeUndefined();
  });

  it("round-trips a create-repo intent", async () => {
    const m = await import("../../src/lib/github-user-auth");
    const decoded = m.decodeGithubFlowState(
      m.encodeGithubFlowState({ org: "acme", site: "docs", repo: "acme-docs", private: true }),
    );
    expect(decoded).toMatchObject({ org: "acme", site: "docs", repo: "acme-docs", private: true });
  });

  // THE regression: an org-only state (installing from the add-site chooser) has to decode,
  // or the callback can't tell where to return and dumps you on the apex.
  it("accepts an org-only state", async () => {
    const m = await import("../../src/lib/github-user-auth");
    const decoded = m.decodeGithubFlowState(m.encodeGithubFlowState({ org: "acme" }));
    expect(decoded).toMatchObject({ org: "acme" });
    expect(decoded?.site).toBeUndefined();
  });

  it("is opaque — the org, site and repo aren't readable in the URL", async () => {
    const m = await import("../../src/lib/github-user-auth");
    const encoded = m.encodeGithubFlowState({ org: "acme", site: "docs", repo: "acme-docs" });
    for (const secret of ["acme", "docs", "acme-docs"]) {
      expect(encoded).not.toContain(secret);
    }
  });

  it("rejects a tampered, unparseable or absent state", async () => {
    const m = await import("../../src/lib/github-user-auth");
    const encoded = m.encodeGithubFlowState({ org: "acme" });
    expect(m.decodeGithubFlowState(encoded.slice(0, -4) + "AAAA")).toBeNull();
    expect(m.decodeGithubFlowState("not-encrypted")).toBeNull();
    expect(m.decodeGithubFlowState("")).toBeNull();
    expect(m.decodeGithubFlowState(null)).toBeNull();
  });

  it("rejects a state with no org, or a malformed site/repo", async () => {
    const m = await import("../../src/lib/github-user-auth");
    const at = Date.now();
    expect(m.decodeGithubFlowState(encryptSecret(JSON.stringify({ at })))).toBeNull();
    expect(m.decodeGithubFlowState(encryptSecret(JSON.stringify({ org: "", at })))).toBeNull();
    expect(
      m.decodeGithubFlowState(encryptSecret(JSON.stringify({ org: "a", site: 7, at }))),
    ).toBeNull();
    expect(
      m.decodeGithubFlowState(encryptSecret(JSON.stringify({ org: "a", repo: "", at }))),
    ).toBeNull();
  });

  // Installing involves picking repositories on GitHub, so the window is generous — but a
  // state resurfacing much later is stale or replayed.
  it("expires", async () => {
    const m = await import("../../src/lib/github-user-auth");
    const encoded = m.encodeGithubFlowState({ org: "acme" });
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 31 * 60_000);
    expect(m.decodeGithubFlowState(encoded)).toBeNull();
  });

  // The state carries IDENTIFIERS, never a path — the callback rebuilds the URL from its own
  // helpers, so this can't be steered into an open redirect.
  it("drops any extra field, so no path can ride along", async () => {
    const m = await import("../../src/lib/github-user-auth");
    const decoded = m.decodeGithubFlowState(
      encryptSecret(JSON.stringify({ org: "acme", returnTo: "https://evil.test", at: Date.now() })),
    );
    expect(decoded).toEqual({ org: "acme", at: expect.any(Number) });
    expect(JSON.stringify(decoded)).not.toContain("evil");
  });
});
