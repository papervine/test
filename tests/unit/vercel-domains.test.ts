import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  customDomainCnameTarget,
  parseDomainStatus,
  vercelDomainsConfigured,
  VERCEL_CNAME_TARGET,
} from "@/lib/vercel-domains";

describe("parseDomainStatus", () => {
  it("folds a verified project domain with no challenge into a clean status", () => {
    const status = parseDomainStatus({ verified: true, verification: [] }, { misconfigured: false });
    expect(status).toEqual({ verified: true, misconfigured: false, verification: [] });
  });

  it("keeps Vercel's ownership-challenge records, dropping malformed entries", () => {
    const status = parseDomainStatus(
      {
        verified: false,
        verification: [
          { type: "TXT", domain: "_vercel.example.com", value: "vc-domain-verify=…" },
          { nope: true }, // malformed — must be filtered out
        ],
      },
      { misconfigured: true },
    );
    expect(status.verified).toBe(false);
    expect(status.misconfigured).toBe(true);
    expect(status.verification).toEqual([
      { type: "TXT", domain: "_vercel.example.com", value: "vc-domain-verify=…" },
    ]);
  });

  it("treats missing/partial responses as not-verified, not-misconfigured, no records", () => {
    expect(parseDomainStatus(null, null)).toEqual({
      verified: false,
      misconfigured: false,
      verification: [],
    });
    // A truthy-but-non-boolean `verified` must not read as connected.
    expect(parseDomainStatus({ verified: "yes" }, {}).verified).toBe(false);
  });
});

describe("vercelDomainsConfigured", () => {
  const saved = { token: process.env.VERCEL_TOKEN, project: process.env.VERCEL_PROJECT_ID };
  beforeEach(() => {
    delete process.env.VERCEL_TOKEN;
    delete process.env.VERCEL_PROJECT_ID;
  });
  afterEach(() => {
    if (saved.token === undefined) delete process.env.VERCEL_TOKEN;
    else process.env.VERCEL_TOKEN = saved.token;
    if (saved.project === undefined) delete process.env.VERCEL_PROJECT_ID;
    else process.env.VERCEL_PROJECT_ID = saved.project;
  });

  it("is off unless BOTH the token and project id are present", () => {
    expect(vercelDomainsConfigured()).toBe(false);
    process.env.VERCEL_TOKEN = "tok";
    expect(vercelDomainsConfigured()).toBe(false); // token alone isn't enough
    process.env.VERCEL_PROJECT_ID = "prj_123";
    expect(vercelDomainsConfigured()).toBe(true);
  });
});

describe("customDomainCnameTarget", () => {
  const saved = {
    brand: process.env.CUSTOM_DOMAIN_CNAME_TARGET,
    token: process.env.VERCEL_TOKEN,
    project: process.env.VERCEL_PROJECT_ID,
  };
  beforeEach(() => {
    delete process.env.CUSTOM_DOMAIN_CNAME_TARGET;
    delete process.env.VERCEL_TOKEN;
    delete process.env.VERCEL_PROJECT_ID;
  });
  afterEach(() => {
    for (const [k, v] of [
      ["CUSTOM_DOMAIN_CNAME_TARGET", saved.brand],
      ["VERCEL_TOKEN", saved.token],
      ["VERCEL_PROJECT_ID", saved.project],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("prefers the operator's branded host over everything (and any provider) — the self-host knob", () => {
    process.env.CUSTOM_DOMAIN_CNAME_TARGET = "cname.yourdocs.com";
    process.env.VERCEL_TOKEN = "tok";
    process.env.VERCEL_PROJECT_ID = "prj_123";
    expect(customDomainCnameTarget("app.papervine.io")).toBe("cname.yourdocs.com");
  });

  it("falls back to the raw Vercel edge when Vercel manages domains but no brand is set", () => {
    process.env.VERCEL_TOKEN = "tok";
    process.env.VERCEL_PROJECT_ID = "prj_123";
    expect(customDomainCnameTarget("app.papervine.io")).toBe(VERCEL_CNAME_TARGET);
  });

  it("falls back to the platform apex when neither a brand nor Vercel is configured (self-host)", () => {
    expect(customDomainCnameTarget("app.papervine.io")).toBe("app.papervine.io");
  });
});
