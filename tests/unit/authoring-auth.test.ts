import { describe, expect, it } from "vitest";
import { authoringDecision, denialMessage } from "@/lib/authoring-auth";

/**
 * The authoring MCP's authorization rules (SPEC §9.2/§11). This is the gate on a surface that
 * writes to a customer's Git repository, so it's worth pinning at the layer where the rules
 * actually live rather than only through an e2e that happens to exercise one path.
 *
 * `authoringDecision` is pure by design — no database, no request — which is what makes the
 * order of its checks testable. That order is a security property, not a style choice: see the
 * disclosure test at the bottom.
 */
const ALLOWED = {
  userId: "u1",
  orgSlug: "acme",
  siteSlug: "docs",
  isMember: true,
  role: "owner",
  siteExists: true,
};

describe("authoringDecision", () => {
  it("allows an owner with a resolved site", () => {
    expect(authoringDecision(ALLOWED)).toEqual({ ok: true });
  });

  it("allows an admin — the editor feature's audience", () => {
    expect(authoringDecision({ ...ALLOWED, role: "admin" })).toEqual({ ok: true });
  });

  it("refuses a plain member, whose role can't clear the editor feature", () => {
    expect(authoringDecision({ ...ALLOWED, role: "member" })).toEqual({
      ok: false,
      denial: "insufficient-role",
    });
  });

  it("refuses an anonymous caller", () => {
    expect(authoringDecision({ ...ALLOWED, userId: null })).toEqual({
      ok: false,
      denial: "unauthenticated",
    });
  });

  it("refuses a non-member even when the site exists", () => {
    expect(authoringDecision({ ...ALLOWED, isMember: false, role: null })).toEqual({
      ok: false,
      denial: "not-a-member",
    });
  });

  it("refuses when no site was named", () => {
    expect(authoringDecision({ ...ALLOWED, siteSlug: null })).toEqual({
      ok: false,
      denial: "no-target",
    });
    expect(authoringDecision({ ...ALLOWED, orgSlug: null })).toEqual({
      ok: false,
      denial: "no-target",
    });
  });

  it("refuses a site that isn't in this org", () => {
    expect(authoringDecision({ ...ALLOWED, siteExists: false })).toEqual({
      ok: false,
      denial: "no-such-site",
    });
  });

  // The checks run identity → membership → role → existence, and the order is load-bearing.
  // If existence were checked first, an anonymous caller could probe org and site slugs by
  // reading which refusal came back — the endpoint becomes a directory of who our customers
  // are. Everyone who hasn't proved membership gets the same answer instead.
  it("does not disclose whether an org or site exists to someone who can't see it", () => {
    const anonymous = authoringDecision({
      ...ALLOWED,
      userId: null,
      isMember: false,
      role: null,
      siteExists: false,
    });
    const anonymousAtRealSite = authoringDecision({
      ...ALLOWED,
      userId: null,
      isMember: false,
      role: null,
      siteExists: true,
    });
    expect(anonymous).toEqual(anonymousAtRealSite);

    const outsider = authoringDecision({ ...ALLOWED, isMember: false, role: null });
    const outsiderAtMissingSite = authoringDecision({
      ...ALLOWED,
      isMember: false,
      role: null,
      siteExists: false,
    });
    expect(outsider).toEqual(outsiderAtMissingSite);
  });
});

describe("denialMessage", () => {
  it("gives every denial an actionable message", () => {
    const denials = [
      "unauthenticated",
      "no-target",
      "not-a-member",
      "insufficient-role",
      "no-such-site",
    ] as const;
    for (const denial of denials) {
      expect(denialMessage(denial).length, denial).toBeGreaterThan(10);
    }
  });

  it("does not distinguish a missing org from one you aren't in", () => {
    // The message is user-facing, so the non-disclosure above has to survive into the wording.
    expect(denialMessage("not-a-member")).toMatch(/No such organization, or you are not/);
  });
});
