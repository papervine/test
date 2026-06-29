import { describe, it, expect } from "vitest";
import {
  normalizeHost,
  siteSlugTag,
  siteDomainTag,
  reviveSiteDates,
  SITE_ROW_TTL,
} from "@/lib/site-cache";

// A minimal site row — reviveSiteDates only touches the three timestamp columns and spreads the
// rest, so we exercise those plus a couple of passthrough fields. Cast: the runtime cached shape
// has string timestamps, which is the case we most need to cover.
function row(over: Record<string, unknown> = {}) {
  return {
    id: "s1",
    slug: "acme",
    customDomain: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-06-29T12:00:00.000Z"),
    customDomainVerifiedAt: null,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("reviveSiteDates", () => {
  it("parses ISO-string timestamps from a Data Cache round-trip back into Dates", () => {
    // The bug it guards: requestContentSource folds updatedAt.getTime() into the content-cache
    // version key; a string there silently changes the key and serves stale content.
    const cached = row({
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-06-29T12:00:00.000Z",
      customDomainVerifiedAt: "2026-06-01T00:00:00.000Z",
    });
    const r = reviveSiteDates(cached)!;
    expect(r.updatedAt).toBeInstanceOf(Date);
    expect(r.createdAt).toBeInstanceOf(Date);
    expect(r.customDomainVerifiedAt).toBeInstanceOf(Date);
    expect(r.updatedAt.getTime()).toBe(Date.parse("2026-06-29T12:00:00.000Z"));
  });

  it("leaves an already-Date (uncached) row as Dates", () => {
    const r = reviveSiteDates(row())!;
    expect(r.updatedAt).toBeInstanceOf(Date);
    expect(r.updatedAt.getTime()).toBe(Date.parse("2026-06-29T12:00:00.000Z"));
  });

  it("keeps a null customDomainVerifiedAt null (not Date(null) → epoch)", () => {
    expect(reviveSiteDates(row({ customDomainVerifiedAt: null }))!.customDomainVerifiedAt).toBeNull();
  });

  it("passes a null row through", () => {
    expect(reviveSiteDates(null)).toBeNull();
  });
});

describe("normalizeHost", () => {
  it("strips the port and lowercases so a host maps to one cache entry", () => {
    expect(normalizeHost("Docs.Example.com:443")).toBe("docs.example.com");
    expect(normalizeHost("docs.example.com")).toBe("docs.example.com");
  });
});

describe("cache tags", () => {
  it("are stable and distinct per slug / domain (so a bust hits the right entry)", () => {
    expect(siteSlugTag("acme")).toBe("site-row:slug:acme");
    expect(siteSlugTag("acme")).not.toBe(siteSlugTag("other"));
  });

  it("normalize the domain tag the same way the lookup does, so the bust matches the read", () => {
    // getSiteByCustomDomain keys on normalizeHost(host); revalidateSiteRow must tag the same way
    // or a removed/changed domain would linger in cache. This asserts they agree.
    expect(siteDomainTag("Docs.Example.com:443")).toBe(siteDomainTag("docs.example.com"));
    expect(siteDomainTag("docs.example.com")).toBe("site-row:domain:docs.example.com");
  });

  it("uses a sane backstop TTL", () => {
    expect(SITE_ROW_TTL).toBeGreaterThan(0);
    expect(SITE_ROW_TTL).toBeLessThanOrEqual(300);
  });
});
