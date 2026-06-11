import { describe, it, expect, afterEach } from "vitest";
import { parseRepoInput, ghHeaders } from "@/lib/github";

describe("parseRepoInput", () => {
  it("parses owner/name", () => {
    expect(parseRepoInput("papervine/starter")).toEqual({ owner: "papervine", name: "starter" });
  });
  it("parses a github.com URL", () => {
    expect(parseRepoInput("https://github.com/phishy/papervine")).toEqual({
      owner: "phishy",
      name: "papervine",
    });
  });
  it("strips a trailing .git", () => {
    expect(parseRepoInput("git@github.com:phishy/papervine.git")).toEqual({
      owner: "phishy",
      name: "papervine",
    });
  });
  it("rejects garbage", () => {
    expect(parseRepoInput("not a repo")).toBeNull();
    expect(parseRepoInput("")).toBeNull();
  });
});

describe("ghHeaders", () => {
  const saved = process.env.GITHUB_TOKEN;
  afterEach(() => {
    if (saved === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = saved;
  });

  it("authenticates with a per-site token when given one", () => {
    const h = ghHeaders("site-token") as Record<string, string>;
    expect(h.authorization).toBe("Bearer site-token");
  });

  it("falls back to GITHUB_TOKEN when no token is passed", () => {
    process.env.GITHUB_TOKEN = "env-token";
    expect((ghHeaders() as Record<string, string>).authorization).toBe("Bearer env-token");
  });

  it("prefers the per-site token over GITHUB_TOKEN", () => {
    process.env.GITHUB_TOKEN = "env-token";
    expect((ghHeaders("site-token") as Record<string, string>).authorization).toBe(
      "Bearer site-token",
    );
  });

  it("omits authorization when neither is present", () => {
    delete process.env.GITHUB_TOKEN;
    expect((ghHeaders() as Record<string, string>).authorization).toBeUndefined();
  });
});
