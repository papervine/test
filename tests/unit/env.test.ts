import { describe, it, expect } from "vitest";
import { resolveDeployEnv, envBadge } from "@/lib/env";

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

  it("marks preview and local with distinct variants", () => {
    expect(envBadge("preview")).toEqual({ label: "preview", variant: "preview" });
    expect(envBadge("development")).toEqual({ label: "local", variant: "local" });
  });
});
