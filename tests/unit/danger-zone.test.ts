import { describe, it, expect } from "vitest";
import {
  isReasonValid,
  confirmationMatches,
  canDelete,
} from "@/lib/danger-zone";

describe("isReasonValid", () => {
  it("requires a non-empty reason", () => {
    expect(isReasonValid("we migrated away")).toBe(true);
    expect(isReasonValid("")).toBe(false);
  });

  it("treats whitespace-only as empty", () => {
    expect(isReasonValid("   ")).toBe(false);
    expect(isReasonValid("\n\t")).toBe(false);
  });
});

describe("confirmationMatches", () => {
  it("matches the exact name after trimming", () => {
    expect(confirmationMatches("pixwel", "pixwel")).toBe(true);
    expect(confirmationMatches("  pixwel  ", "pixwel")).toBe(true);
  });

  it("is case-sensitive (GitHub-style)", () => {
    expect(confirmationMatches("Pixwel", "pixwel")).toBe(false);
  });

  it("rejects a near-miss", () => {
    expect(confirmationMatches("pixwe", "pixwel")).toBe(false);
    expect(confirmationMatches("", "pixwel")).toBe(false);
  });
});

describe("canDelete", () => {
  it("arms only when both the reason and the typed name pass", () => {
    expect(canDelete("leaving", "acme", "acme")).toBe(true);
    expect(canDelete("", "acme", "acme")).toBe(false);
    expect(canDelete("leaving", "acm", "acme")).toBe(false);
    expect(canDelete("  ", "acme", "acme")).toBe(false);
  });
});
