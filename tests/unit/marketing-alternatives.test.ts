import { describe, it, expect } from "vitest";
import {
  ALTERNATIVES,
  DISCLAIMER,
  FAQS,
  PRICES_CHECKED,
  REASONS,
  faqJsonLd,
} from "@/lib/marketing-alternatives";

// Content-integrity guards for the /docs-platform-alternatives page. Not a rendering test — the
// point is that the RULES the page is written under (marketing-alternatives.ts header) can't
// be quietly dropped by a later edit. The page ARGUES for us, deliberately; what these guard
// is the part that has to stay true while it does: every competitor claim carries a source,
// the disclaimer still disclaims, our licence is described accurately rather than
// flatteringly, and the FAQ rich result can't advertise an answer the page doesn't render.
//
// Deliberately no assertion on how OLD PRICES_CHECKED is: a freshness deadline in a test is a
// time bomb that fails CI on an unrelated PR months later. Staleness is a review question, not
// a build failure.

describe("alternatives content", () => {
  it("lists ten options, with exactly one marked as ours", () => {
    expect(ALTERNATIVES).toHaveLength(10);
    expect(ALTERNATIVES.filter((a) => a.us)).toHaveLength(1);
    expect(ALTERNATIVES.find((a) => a.us)?.key).toBe("papervine");
  });

  it("has unique keys (they're the page's anchor ids)", () => {
    const keys = ALTERNATIVES.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("sources every competitor claim at the vendor's own page", () => {
    for (const alt of ALTERNATIVES) {
      if (alt.us) {
        // Ours points at our own pricing page, which is a root-relative link.
        expect(alt.source).toBe("/pricing");
        continue;
      }
      expect(alt.source, `${alt.name} needs a source URL`).toMatch(/^https:\/\//);
    }
  });

  it("states the trade for every option, and states ours in our own words", () => {
    for (const alt of ALTERNATIVES) {
      // A competitor's `caveat` is a substantive fact about their pricing or model — long
      // enough to be one, since a one-liner would be a swipe rather than information. Ours is
      // deliberately shorter: this is a sales page, and the balanced self-critique the first
      // draft carried belongs in a market survey, not on a storefront.
      const floor = alt.us ? 80 : 120;
      expect(alt.caveat.length, `${alt.name} caveat is too thin`).toBeGreaterThan(floor);
      expect(alt.bestFor.length).toBeGreaterThan(10);
      expect(alt.body.length).toBeGreaterThan(120);
    }
  });

  it("fills in every table cell (an empty column reads as a missing feature)", () => {
    for (const alt of ALTERNATIVES) {
      for (const field of ["name", "price", "topTier", "hosting", "format", "ssoOn"] as const) {
        expect(alt[field], `${alt.name}.${field}`).toBeTruthy();
      }
    }
  });

  it("keeps our own entry honest about the licence", () => {
    // The CLI ships under the Elastic License 2.0, which is source-available and NOT OSI open
    // source. This page is exactly where that distinction gets checked by readers.
    const us = ALTERNATIVES.find((a) => a.us)!;
    const copy = `${us.body} ${us.caveat}`;
    expect(copy).toMatch(/source-available/i);
    expect(copy).toMatch(/Elastic License 2\.0/);
    // Forbids the CLAIM, not the word: "not the same thing as OSI open source" is the
    // disclaimer we want, while "is open source" / "fully open source" would be false.
    expect(copy).not.toMatch(/\b(?:is|fully|100%|truly|completely)\s+open[- ]source\b/i);
  });

  it("sources every pricing-structure claim in the reasons section", () => {
    expect(REASONS.length).toBeGreaterThanOrEqual(4);
    for (const r of REASONS) {
      expect(r.source, r.title).toMatch(/^https:\/\//);
      expect(r.body.length).toBeGreaterThan(120);
    }
  });

  it("disclaims affiliation and dates its prices", () => {
    expect(DISCLAIMER).toMatch(/not affiliated/i);
    expect(DISCLAIMER).toMatch(/trademarks/i);
    expect(DISCLAIMER).toContain(PRICES_CHECKED);
    expect(PRICES_CHECKED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("faqJsonLd", () => {
  it("emits a FAQPage carrying every question the page renders", () => {
    const parsed = JSON.parse(faqJsonLd());
    expect(parsed["@type"]).toBe("FAQPage");
    expect(parsed.mainEntity).toHaveLength(FAQS.length);
    expect(parsed.mainEntity.map((q: { name: string }) => q.name)).toEqual(
      FAQS.map((f) => f.q),
    );
    for (const entry of parsed.mainEntity) {
      expect(entry.acceptedAnswer.text.length).toBeGreaterThan(40);
    }
  });

  it("is inlined into a <script>, so it must not carry a closing tag or a lone <", () => {
    // The page injects this with dangerouslySetInnerHTML; a "</script>" inside any answer
    // would end the tag early and spill the rest of the JSON into the document.
    const json = faqJsonLd();
    expect(json).not.toMatch(/<\/script/i);
    expect(json).not.toContain("<");
  });
});
