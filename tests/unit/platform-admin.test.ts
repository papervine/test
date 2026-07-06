import { describe, it, expect } from "vitest";
import {
  isPlatformAdminEmail,
  platformAdminEmails,
  resolvePlatformRole,
} from "@/lib/platform-admin";

describe("platformAdminEmails", () => {
  it("splits, trims, and lowercases the env list", () => {
    expect(platformAdminEmails(" Jeff@Loiselles.com , ops@papervine.io ")).toEqual([
      "jeff@loiselles.com",
      "ops@papervine.io",
    ]);
  });
  it("drops empty entries (trailing commas, blank list)", () => {
    expect(platformAdminEmails("a@b.com,,")).toEqual(["a@b.com"]);
    expect(platformAdminEmails("")).toEqual([]);
    expect(platformAdminEmails(undefined)).toEqual([]);
  });
});

describe("isPlatformAdminEmail", () => {
  it("matches case-insensitively", () => {
    expect(isPlatformAdminEmail("JEFF@loiselles.com", "jeff@loiselles.com")).toBe(true);
  });
  it("an unset allowlist means nobody is admin", () => {
    expect(isPlatformAdminEmail("jeff@loiselles.com", undefined)).toBe(false);
    expect(isPlatformAdminEmail("jeff@loiselles.com", "")).toBe(false);
  });
  it("never matches a missing email", () => {
    expect(isPlatformAdminEmail(null, "a@b.com")).toBe(false);
    expect(isPlatformAdminEmail("", "a@b.com")).toBe(false);
  });
  it("requires an exact entry, not a substring", () => {
    expect(isPlatformAdminEmail("eff@loiselles.com", "jeff@loiselles.com")).toBe(false);
  });
});

describe("resolvePlatformRole", () => {
  const LIST = "jeff@loiselles.com";
  it("grants admin to an allowlisted user without the role", () => {
    expect(resolvePlatformRole("jeff@loiselles.com", LIST, null)).toBe("admin");
    expect(resolvePlatformRole("jeff@loiselles.com", LIST, "user")).toBe("admin");
  });
  it("revokes admin from a user no longer on the allowlist", () => {
    expect(resolvePlatformRole("gone@example.com", LIST, "admin")).toBe("user");
    expect(resolvePlatformRole("gone@example.com", undefined, "admin")).toBe("user");
  });
  it("returns null when the row already matches (no write)", () => {
    expect(resolvePlatformRole("jeff@loiselles.com", LIST, "admin")).toBe(null);
    expect(resolvePlatformRole("normal@example.com", LIST, null)).toBe(null);
    expect(resolvePlatformRole("normal@example.com", LIST, "user")).toBe(null);
  });
});
