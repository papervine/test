import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { canSeeFeature } from "../../src/lib/features";

// The operator allowlist is immune to billing and launch-flag gates (SPEC §10.10).
//
// Two rules that must NOT blur together, and the tests exist to keep them apart:
//   • Gates about AVAILABILITY — is this in your plan, has it shipped — lift for an
//     operator. Being told to upgrade, or having a surface hidden, helps nobody who is
//     being asked to debug it.
//   • Gates about PERMISSION — may you mutate this org — do NOT lift. The cross-tenant
//     platform-admin view is read-only by construction (dashboard-context), and an
//     operator looking at a customer's dashboard must not gain write access to it.

const ORIGINAL = { ...process.env };
const ADMIN = "ops@papervine.io";

beforeEach(() => {
  vi.resetModules();
  process.env.PLATFORM_ADMIN_EMAILS = `${ADMIN}, other@papervine.io`;
  delete process.env.AUTUMN_SECRET_KEY; // no billing backend in unit tests
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

// store.ts pulls in the DB and Autumn; neither is reachable here, and neither should be
// consulted for an operator — the bypass must short-circuit before any lookup.
vi.mock("../../src/lib/db", () => ({ db: {} }));
vi.mock("../../src/lib/billing/autumn", () => ({
  autumnConfigured: () => true,
  lookupOrg: async () => {
    throw new Error("lookupOrg must not be called for a platform admin");
  },
  ensureCustomer: async () => undefined,
  attachPlan: async () => undefined,
  trackCredits: async () => undefined,
}));

async function store() {
  return import("../../src/lib/billing/store");
}

describe("authorizeAi", () => {
  it("never refuses an allowlisted operator, and does not consult billing at all", async () => {
    const { authorizeAi } = await store();
    // The mocked lookupOrg throws — reaching it would fail this test, which is the point:
    // the bypass has to come before the lookup, not after.
    expect(await authorizeAi("org_someone_else", "workflows", { actorEmail: ADMIN })).toEqual({
      allowed: true,
      // METERED on purpose: immunity means "not blocked", not "spends invisibly" (§18 is
      // metering-first), so an operator's usage still shows up.
      metered: true,
    });
  });

  it("is case- and whitespace-insensitive about the address", async () => {
    const { authorizeAi } = await store();
    expect(
      await authorizeAi("org1", "assistant", { actorEmail: "  OPS@Papervine.IO " }),
    ).toMatchObject({ allowed: true });
  });

  it("does not lift for anyone else, or when no actor is known", async () => {
    const { authorizeAi } = await store();
    // A background run has no acting user — it must be gated normally. (lookupOrg throws
    // here, so a non-admin path reaching billing is exactly what we expect.)
    await expect(authorizeAi("org1", "workflows", { actorEmail: "user@acme.com" })).rejects.toThrow();
    await expect(authorizeAi("org1", "workflows")).rejects.toThrow();
  });

  it("grants nothing when the allowlist is unset — the surface stays dark", async () => {
    delete process.env.PLATFORM_ADMIN_EMAILS;
    const { authorizeAi } = await store();
    await expect(authorizeAi("org1", "workflows", { actorEmail: ADMIN })).rejects.toThrow();
  });
});

describe("getUnlock", () => {
  it("never locks a surface for an allowlisted operator", async () => {
    const { getUnlock } = await store();
    expect(await getUnlock("org_someone_else", "agent", { actorEmail: ADMIN })).toEqual({
      locked: false,
    });
  });

  it("gates everyone else normally", async () => {
    const { getUnlock } = await store();
    await expect(getUnlock("org1", "agent", { actorEmail: "user@acme.com" })).rejects.toThrow();
  });
});

describe("canSeeFeature", () => {
  it("shows an operator every surface, including one still dark at 'off'", async () => {
    // Launch flags answer "has this shipped", and the operator is who needs to see the
    // things that haven't.
    expect(canSeeFeature("automate.agent", null, true)).toBe(true);
    expect(canSeeFeature("editor.workspace", "member", true)).toBe(true);
  });

  it("is unchanged for everyone else", async () => {
    expect(canSeeFeature("automate.agent", "owner")).toBe(true);
    expect(canSeeFeature("automate.agent", "member")).toBe(false);
    expect(canSeeFeature("automate.agent", null)).toBe(false);
    // Explicitly false is the same as omitted — no accidental opening.
    expect(canSeeFeature("automate.agent", "member", false)).toBe(false);
  });
});
