import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// requireOrg is the dashboard's authorization gate (SPEC §10 + the §10.10 platform-admin
// bypass). These tests pin its access matrix — member, allowlisted non-member, plain
// non-member, signed-out — with the session and db modules mocked, so a refactor can't
// silently widen (or break) who resolves an org.

// next/navigation's notFound/redirect throw; sentinel errors let us assert which fired.
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

const state = {
  session: null as { user: { id: string; email: string } } | null,
  orgs: [] as { id: string; slug: string; name: string }[],
  memberRole: null as string | null,
  // Queued results for successive db.select() chains, in call order.
  dbResults: [] as unknown[][],
};

vi.mock("@/lib/session", () => ({
  getSession: vi.fn(async () => state.session),
  listOrganizations: vi.fn(async () => state.orgs),
  getMemberRole: vi.fn(async () => state.memberRole),
}));

// Minimal drizzle stand-in: every builder method chains, awaiting the chain resolves to
// the next queued result. requireOrg issues (org lookup).limit(1) and (sites).orderBy().
vi.mock("@/lib/db", () => ({
  db: {
    select: () => {
      const chain: Record<string, unknown> = {};
      for (const m of ["from", "where", "orderBy", "limit", "innerJoin", "groupBy"]) {
        chain[m] = () => chain;
      }
      chain.then = (resolve: (rows: unknown[]) => void) =>
        resolve(state.dbResults.shift() ?? []);
      return chain;
    },
  },
}));

import { requireOrg } from "@/lib/dashboard-context";

const SELF = { user: { id: "u1", email: "admin@example.com" } };
const ACME = { id: "org1", slug: "acme", name: "Acme" };
const SITES = [{ id: "s1", slug: "docs", name: "Docs" }];

beforeEach(() => {
  state.session = SELF;
  state.orgs = [];
  state.memberRole = null;
  state.dbResults = [];
  delete process.env.PLATFORM_ADMIN_EMAILS;
});
afterEach(() => {
  delete process.env.PLATFORM_ADMIN_EMAILS;
});

describe("requireOrg", () => {
  it("resolves a member's own org with their role (no bypass flag)", async () => {
    state.orgs = [ACME];
    state.memberRole = "owner";
    state.dbResults = [SITES];
    const ctx = await requireOrg("acme");
    expect(ctx.org).toEqual(ACME);
    expect(ctx.role).toBe("owner");
    expect(ctx.sites).toEqual(SITES);
    expect(ctx.platformAdminView).toBe(false);
  });

  it("redirects signed-out visitors to /login", async () => {
    state.session = null;
    await expect(requireOrg("acme")).rejects.toThrow("REDIRECT:/login");
  });

  it("404s a non-member who is not a platform admin", async () => {
    state.orgs = [{ id: "org2", slug: "own-org", name: "Own Org" }];
    await expect(requireOrg("acme")).rejects.toThrow("NOT_FOUND");
  });

  it("redirects an org-less non-admin to /onboarding", async () => {
    state.orgs = [];
    await expect(requireOrg("acme")).rejects.toThrow("REDIRECT:/onboarding");
  });

  it("lets an allowlisted non-member view the org — read-only (role null, flag set)", async () => {
    process.env.PLATFORM_ADMIN_EMAILS = "admin@example.com";
    state.orgs = []; // not a member of anything
    state.dbResults = [[ACME], SITES]; // direct org lookup, then its sites
    const ctx = await requireOrg("acme");
    expect(ctx.org).toEqual(ACME);
    expect(ctx.role).toBe(null);
    expect(ctx.sites).toEqual(SITES);
    expect(ctx.platformAdminView).toBe(true);
  });

  it("membership wins over the bypass — an admin's own org keeps their real role", async () => {
    process.env.PLATFORM_ADMIN_EMAILS = "admin@example.com";
    state.orgs = [ACME];
    state.memberRole = "owner";
    state.dbResults = [SITES];
    const ctx = await requireOrg("acme");
    expect(ctx.role).toBe("owner");
    expect(ctx.platformAdminView).toBe(false);
  });

  it("404s a platform admin on a slug that doesn't exist at all", async () => {
    process.env.PLATFORM_ADMIN_EMAILS = "admin@example.com";
    state.orgs = [];
    state.dbResults = [[]]; // org lookup misses
    await expect(requireOrg("ghost")).rejects.toThrow("NOT_FOUND");
  });
});
