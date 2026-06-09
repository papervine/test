import { describe, it, expect } from "vitest";
import { syncErrorDetail } from "@/lib/sync-error";

describe("syncErrorDetail", () => {
  it("prefers the stack so the dashboard shows where it failed", () => {
    const e = new Error("boom");
    expect(syncErrorDetail(e)).toContain("boom");
    expect(syncErrorDetail(e)).toBe(e.stack);
  });
  it("falls back to the message when there's no stack", () => {
    const e = new Error("no stack here");
    e.stack = undefined;
    expect(syncErrorDetail(e)).toBe("no stack here");
  });
  it("stringifies non-Error throws (e.g. a rejected string)", () => {
    expect(syncErrorDetail("rate limited")).toBe("rate limited");
    expect(syncErrorDetail({ code: 500 })).toBe("[object Object]");
  });
  it("caps the detail so a runaway error can't bloat the row", () => {
    const huge = new Error("x".repeat(5000));
    expect(syncErrorDetail(huge).length).toBe(2000);
  });
});
