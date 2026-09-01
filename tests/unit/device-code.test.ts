import { describe, expect, it } from "vitest";

import { formatUserCode, isPlausibleUserCode, normalizeUserCode } from "../../src/lib/device-code";
import { safeRedirect } from "../../src/lib/safe-redirect";

// The two pure cores behind the device-authorization page (SPEC §11.4): the user-code
// normalizer, and the `?redirect=` sanitizer that lets `papervine signup` resume the approval
// after an account is created.

describe("normalizeUserCode", () => {
  it("upper-cases and strips separators", () => {
    // Better Auth's own lookup only strips `-`; it does NOT upper-case. Without this, a human
    // who types the code in lower case gets "invalid code" for a code sitting in the table.
    expect(normalizeUserCode("abcd-1234")).toBe("ABCD1234");
    expect(normalizeUserCode(" ab cd 12 34 ")).toBe("ABCD1234");
    expect(normalizeUserCode("ABCD_1234")).toBe("ABCD1234");
  });

  it("survives nothing at all", () => {
    expect(normalizeUserCode(null)).toBe("");
    expect(normalizeUserCode(undefined)).toBe("");
  });
});

describe("formatUserCode", () => {
  it("groups the code for the one place a human reads it back", () => {
    expect(formatUserCode("ABCD1234")).toBe("ABCD-1234");
    expect(formatUserCode("abcd1234")).toBe("ABCD-1234");
  });

  it("leaves an implausible length ungrouped rather than inventing a shape", () => {
    expect(formatUserCode("ABC")).toBe("ABC");
    expect(formatUserCode("ABCDEFGHIJKLMNOP")).toBe("ABCDEFGHIJKLMNOP");
  });
});

describe("isPlausibleUserCode", () => {
  it("gates the DB read on something code-shaped", () => {
    expect(isPlausibleUserCode("ABCD1234")).toBe(true);
    expect(isPlausibleUserCode("abcd-1234")).toBe(true);
    expect(isPlausibleUserCode("hi")).toBe(false);
    expect(isPlausibleUserCode("")).toBe(false);
  });
});

describe("safeRedirect", () => {
  it("accepts a same-host path with query", () => {
    expect(safeRedirect("/device?user_code=ABCD1234")).toBe("/device?user_code=ABCD1234");
  });

  it("refuses anything that could leave this origin", () => {
    // A login page that forwards to an arbitrary origin hands over a freshly authenticated
    // visitor — the textbook open redirect.
    expect(safeRedirect("https://evil.example/steal")).toBeNull();
    expect(safeRedirect("//evil.example/steal")).toBeNull();
    // Backslashes because some URL parsers normalize them to `/`, which turns `/\evil.example`
    // into a protocol-relative URL.
    expect(safeRedirect("/\\evil.example")).toBeNull();
    expect(safeRedirect("javascript:alert(1)")).toBeNull();
  });

  it("treats absent and blank as no redirect", () => {
    expect(safeRedirect(null)).toBeNull();
    expect(safeRedirect(undefined)).toBeNull();
    expect(safeRedirect("   ")).toBeNull();
  });
});
