import { describe, it, expect } from "vitest";
import {
  MARKETING_ROUTES,
  isMarketingHost,
  robotsPolicyFor,
  sitemapFor,
} from "@/lib/seo-routes";
import { MARKETING_ORIGIN } from "@/lib/marketing-seo";

// The host-awareness of robots.txt / sitemap.xml (SPEC §2). One Next app answers on four kinds
// of host, so the thing worth testing is not "does a sitemap render" but "does the WRONG host
// get ours" — a leak that would be invisible in dev (where every host is localhost) and
// visible on a customer's domain.

const apex = { host: "papervine.io", singleRepo: false };
const www = { host: "www.papervine.io", singleRepo: false };
const app = { host: "app.papervine.io", singleRepo: false };
const tenant = { host: "acme.papervine.dev", singleRepo: false };
const custom = { host: "docs.acme.com", singleRepo: false };
const cli = { host: "localhost:3000", singleRepo: true };

describe("isMarketingHost", () => {
  it("is true for the apex, with or without www, and in local dev", () => {
    expect(isMarketingHost(apex)).toBe(true);
    expect(isMarketingHost(www)).toBe(true);
    expect(isMarketingHost({ host: "localhost:3000", singleRepo: false })).toBe(true);
    expect(isMarketingHost({ host: "127.0.0.1:4187", singleRepo: false })).toBe(true);
  });

  it("is false for the app host, tenant hosts and custom domains", () => {
    expect(isMarketingHost(app)).toBe(false);
    expect(isMarketingHost(tenant)).toBe(false);
    expect(isMarketingHost(custom)).toBe(false);
    expect(isMarketingHost({ host: "acme.localhost:3000", singleRepo: false })).toBe(false);
  });

  it("is false in single-repo mode even on the apex host", () => {
    // `npx papervine dev` / `papervine serve`: the apex is somebody else's docs repo.
    expect(isMarketingHost(cli)).toBe(false);
    expect(isMarketingHost({ host: "papervine.io", singleRepo: true })).toBe(false);
  });
});

describe("robotsPolicyFor", () => {
  it("advertises the sitemap only on our marketing apex", () => {
    expect(robotsPolicyFor(apex)).toEqual({
      allow: true,
      sitemap: `${MARKETING_ORIGIN}/sitemap.xml`,
    });
    expect(robotsPolicyFor(www).sitemap).toBe(`${MARKETING_ORIGIN}/sitemap.xml`);
  });

  it("points at the canonical origin, never at the host that asked", () => {
    // A preview deployment (`*.vercel.app`) and local dev both count as our marketing host —
    // and both advertise the REAL apex's sitemap rather than their own URL. That's the
    // desirable direction: the sitemap lists canonical URLs, so a crawler that reads a
    // preview's robots.txt is sent to the site we actually want indexed (Vercel's own
    // noindex header keeps the preview itself out of the index).
    for (const host of ["papervine-git-x.vercel.app", "localhost:3000"]) {
      expect(robotsPolicyFor({ host, singleRepo: false }).sitemap).toBe(
        `${MARKETING_ORIGIN}/sitemap.xml`,
      );
    }
  });

  it("disallows everything on the authenticated app host", () => {
    expect(robotsPolicyFor(app)).toEqual({ allow: false });
  });

  it("points a tenant or custom domain at ITS OWN sitemap, on its own origin", () => {
    // A custom domain has to advertise itself rather than the subdomain behind it, which is
    // why this comes from the request Host and not from any stored slug.
    expect(robotsPolicyFor(tenant)).toEqual({
      allow: true,
      sitemap: "https://acme.papervine.dev/sitemap.xml",
    });
    expect(robotsPolicyFor(custom)).toEqual({
      allow: true,
      sitemap: "https://docs.acme.com/sitemap.xml",
    });
  });

  it("never advertises our sitemap from a CLI-served repo", () => {
    // The regression this guards: `papervine serve` on someone's own docs, publishing OUR
    // sitemap pointer at their root. It advertises the repo's own sitemap now — over http,
    // because that is what a local server can answer.
    expect(robotsPolicyFor(cli)).toEqual({
      allow: true,
      sitemap: "http://localhost:3000/sitemap.xml",
    });
  });

  it("treats docs.{platform} as a docs site, never as the marketing apex", () => {
    // `docs` is reserved from slug resolution and claimable as a custom domain, which is what
    // the dogfood site does — so to a host-only check it looked exactly like the apex, and
    // this route served the MARKETING sitemap on docs.papervine.io in production.
    const docsHost = { host: "docs.papervine.io", singleRepo: false };
    expect(isMarketingHost(docsHost)).toBe(false);
    // With the site row resolved, it advertises its own sitemap…
    expect(robotsPolicyFor({ ...docsHost, docsSite: true })).toEqual({
      allow: true,
      sitemap: "https://docs.papervine.io/sitemap.xml",
    });
    // …and without one — a database outage — it says nothing rather than the wrong thing.
    expect(robotsPolicyFor(docsHost).sitemap ?? "").not.toContain(MARKETING_ORIGIN);
  });

  it("lets a resolved site row override the host heuristic", () => {
    // How a customer's own domain is recognised, and the same mechanism the docs host uses.
    expect(robotsPolicyFor({ host: "docs.acme.com", singleRepo: false, docsSite: true })).toEqual({
      allow: true,
      sitemap: "https://docs.acme.com/sitemap.xml",
    });
  });

  it("never names the marketing origin on a host that isn't ours", () => {
    // The one invariant that must survive any future change here.
    for (const ctx of [tenant, custom, cli]) {
      expect(robotsPolicyFor(ctx).sitemap ?? "").not.toContain(MARKETING_ORIGIN);
    }
  });
});

describe("sitemapFor", () => {
  it("lists the marketing pages as absolute canonical URLs", () => {
    const entries = sitemapFor(apex);
    expect(entries).toHaveLength(MARKETING_ROUTES.length);
    expect(entries[0].url).toBe(MARKETING_ORIGIN); // "/" has no trailing slash
    expect(entries.map((e) => e.url)).toContain(
      `${MARKETING_ORIGIN}/docs-platform-alternatives`,
    );
    for (const e of entries) expect(e.url.startsWith("https://")).toBe(true);
  });

  it("dates only the page that has a real date to give", () => {
    const entries = sitemapFor(apex);
    const dated = entries.filter((e) => e.lastModified);
    expect(dated).toHaveLength(1);
    expect(dated[0].url).toBe(`${MARKETING_ORIGIN}/docs-platform-alternatives`);
    // The date its prices were checked — not `new Date()`, which would claim every URL
    // changed this second and get the whole lastmod signal discounted.
    expect(dated[0].lastModified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("is EMPTY on every host that isn't our marketing site", () => {
    for (const ctx of [app, tenant, custom, cli]) {
      expect(sitemapFor(ctx), `${ctx.host} must not receive our sitemap`).toEqual([]);
    }
  });

  it("keeps the comparison page in the sitemap (it's the reason this exists)", () => {
    expect(MARKETING_ROUTES.map((r) => r.path)).toContain("/docs-platform-alternatives");
  });
});
