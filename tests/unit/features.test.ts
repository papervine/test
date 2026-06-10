import { describe, it, expect } from "vitest";
import { canSee, canSeeFeature, FEATURES } from "@/lib/features";

describe("canSee", () => {
  it('"off" hides from everyone, including admins', () => {
    expect(canSee("off", "owner")).toBe(false);
    expect(canSee("off", "admin")).toBe(false);
    expect(canSee("off", "member")).toBe(false);
    expect(canSee("off", null)).toBe(false);
  });

  it('"everyone" shows regardless of role (even no membership)', () => {
    expect(canSee("everyone", "member")).toBe(true);
    expect(canSee("everyone", null)).toBe(true);
    expect(canSee("everyone", undefined)).toBe(true);
  });

  it('"admin" clears only for owner/admin', () => {
    expect(canSee("admin", "owner")).toBe(true);
    expect(canSee("admin", "admin")).toBe(true);
    expect(canSee("admin", "member")).toBe(false);
    expect(canSee("admin", null)).toBe(false);
    expect(canSee("admin", undefined)).toBe(false);
  });
});

describe("canSeeFeature", () => {
  it("resolves a configured feature by key", () => {
    // The Automate surfaces ship admin-only for now (SPEC §10.2).
    expect(canSeeFeature("automate.workflows", "owner")).toBe(true);
    expect(canSeeFeature("automate.workflows", "member")).toBe(false);
  });

  it("every configured feature names a valid audience", () => {
    const valid = new Set(["off", "admin", "everyone"]);
    for (const audience of Object.values(FEATURES)) {
      expect(valid.has(audience)).toBe(true);
    }
  });
});
