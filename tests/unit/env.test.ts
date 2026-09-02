import { describe, it, expect } from "vitest";
import { resolveDeployEnv, envBadge, isDevLike, isTestMode } from "@/lib/env";

describe("resolveDeployEnv", () => {
  it("honors VERCEL_ENV when set", () => {
    expect(resolveDeployEnv("production", "production")).toBe("production");
    expect(resolveDeployEnv("preview", "production")).toBe("preview");
    expect(resolveDeployEnv("development", "development")).toBe("development");
  });

  it("falls back to non-prod when VERCEL_ENV is absent", () => {
    expect(resolveDeployEnv(undefined, "development")).toBe("development");
    // local `next build && start`: NODE_ENV=production but NOT a Vercel prod deploy.
    expect(resolveDeployEnv(undefined, "production")).toBe("development");
    expect(resolveDeployEnv(undefined, undefined)).toBe("development");
  });
});

describe("envBadge", () => {
  it("shows nothing in real production", () => {
    expect(envBadge("production")).toBeNull();
  });

  it("marks a preview deploy, which is the one that looks like production", () => {
    expect(envBadge("preview")).toEqual({ label: "preview", variant: "preview" });
  });

  it("shows nothing locally — you know where you are, and it covered Publish", () => {
    expect(envBadge("development")).toBeNull();
  });
});

// The e2e suite is a production BUILD that still needs dev affordances; a self-hoster's
// production build must not get them. The flag, not NODE_ENV, is what tells them apart.
describe("isDevLike / isTestMode", () => {
  it("next dev is dev-like without any flag", () => {
    expect(isDevLike({ NODE_ENV: "development" })).toBe(true);
    expect(isTestMode({ NODE_ENV: "development" })).toBe(false);
  });
  it("a production build is NOT dev-like — the self-hoster case", () => {
    expect(isDevLike({ NODE_ENV: "production" })).toBe(false);
  });
  it("a production build under the e2e suite opts back in", () => {
    expect(isTestMode({ NODE_ENV: "production", PAPERVINE_TEST_MODE: "1" })).toBe(true);
    expect(isDevLike({ NODE_ENV: "production", PAPERVINE_TEST_MODE: "1" })).toBe(true);
  });
  it("only the exact value counts", () => {
    expect(isDevLike({ NODE_ENV: "production", PAPERVINE_TEST_MODE: "true" })).toBe(false);
    expect(isDevLike({ NODE_ENV: "production", PAPERVINE_TEST_MODE: "" })).toBe(false);
  });
});
