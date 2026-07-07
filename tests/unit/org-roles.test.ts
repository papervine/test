import { describe, it, expect } from "vitest";
import { assignableRoles, canEditMemberRole, isOrgRole } from "@/lib/org-roles";

describe("isOrgRole", () => {
  it("accepts exactly the three org roles", () => {
    expect(isOrgRole("member")).toBe(true);
    expect(isOrgRole("admin")).toBe(true);
    expect(isOrgRole("owner")).toBe(true);
    expect(isOrgRole("superuser")).toBe(false);
    expect(isOrgRole("")).toBe(false);
  });
});

describe("assignableRoles", () => {
  it("owner can grant everything, including owner", () => {
    expect(assignableRoles("owner")).toEqual(["member", "admin", "owner"]);
  });

  it("admin stops at admin (Better Auth rejects an admin granting owner)", () => {
    expect(assignableRoles("admin")).toEqual(["member", "admin"]);
  });

  it("member and non-members grant nothing", () => {
    expect(assignableRoles("member")).toEqual([]);
    expect(assignableRoles(null)).toEqual([]);
    expect(assignableRoles(undefined)).toEqual([]);
  });
});

describe("canEditMemberRole", () => {
  it("never lets you edit your own role", () => {
    expect(canEditMemberRole("owner", { role: "owner", isSelf: true })).toBe(false);
  });

  it("owner can edit anyone else, including another owner", () => {
    expect(canEditMemberRole("owner", { role: "member", isSelf: false })).toBe(true);
    expect(canEditMemberRole("owner", { role: "owner", isSelf: false })).toBe(true);
  });

  it("admin can edit members/admins but not an owner", () => {
    expect(canEditMemberRole("admin", { role: "member", isSelf: false })).toBe(true);
    expect(canEditMemberRole("admin", { role: "admin", isSelf: false })).toBe(true);
    expect(canEditMemberRole("admin", { role: "owner", isSelf: false })).toBe(false);
  });

  it("plain members edit nobody", () => {
    expect(canEditMemberRole("member", { role: "member", isSelf: false })).toBe(false);
    expect(canEditMemberRole(null, { role: "member", isSelf: false })).toBe(false);
  });
});
