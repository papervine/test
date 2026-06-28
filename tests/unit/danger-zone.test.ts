import { describe, it, expect } from "vitest";
import {
  isReasonValid,
  confirmationMatches,
  canDelete,
  planResourceCleanup,
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

describe("planResourceCleanup", () => {
  it("always sweeps a site's storage prefix", () => {
    expect(planResourceCleanup([{ id: "abc", customDomain: null }])).toEqual({
      storagePrefixes: ["sites/abc/"],
      domainsToDetach: [],
    });
  });

  it("detaches the custom domain when one is set (the deletion-leak regression)", () => {
    expect(
      planResourceCleanup([{ id: "abc", customDomain: "docs.example.com" }]),
    ).toEqual({
      storagePrefixes: ["sites/abc/"],
      domainsToDetach: ["docs.example.com"],
    });
  });

  it("collects across every site (org delete) and skips the domainless ones", () => {
    const plan = planResourceCleanup([
      { id: "s1", customDomain: "docs.one.com" },
      { id: "s2", customDomain: null },
      { id: "s3", customDomain: "docs.three.com" },
    ]);
    expect(plan.storagePrefixes).toEqual(["sites/s1/", "sites/s2/", "sites/s3/"]);
    expect(plan.domainsToDetach).toEqual(["docs.one.com", "docs.three.com"]);
  });

  it("is a no-op for an org with no sites", () => {
    expect(planResourceCleanup([])).toEqual({
      storagePrefixes: [],
      domainsToDetach: [],
    });
  });
});
