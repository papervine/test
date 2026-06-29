import { describe, it, expect } from "vitest";
import { normalizeSiteName, SITE_NAME_MAX } from "@/lib/site-name";

describe("normalizeSiteName", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeSiteName("  Pixwel Docs  ")).toEqual({ name: "Pixwel Docs" });
  });

  it("rejects empty / whitespace-only names", () => {
    expect(normalizeSiteName("")).toEqual({ error: expect.any(String) });
    expect(normalizeSiteName("   ")).toEqual({ error: expect.any(String) });
    // @ts-expect-error — defensive against a nullish value
    expect(normalizeSiteName(undefined)).toEqual({ error: expect.any(String) });
  });

  it("accepts a name at the max length and rejects one over", () => {
    const atMax = "a".repeat(SITE_NAME_MAX);
    expect(normalizeSiteName(atMax)).toEqual({ name: atMax });
    expect(normalizeSiteName("a".repeat(SITE_NAME_MAX + 1))).toEqual({ error: expect.any(String) });
  });
});
