import { describe, it, expect } from "vitest";
import {
  START_METHODS,
  defaultStartMethod,
  startMethod,
  submitLabel,
  type StartMethod,
} from "../../src/lib/start-methods";

// The catalog behind the add-site chooser (SPEC §10.11). Mostly a meta test in the style of
// features.test.ts: the chooser renders whatever is here, so an entry missing its copy is a
// blank card in the UI, and `startMethod`'s non-null assertion depends on totality.
const VALUES: StartMethod[] = ["scratch", "git"];

describe("START_METHODS", () => {
  it("covers every StartMethod exactly once", () => {
    expect(START_METHODS.map((m) => m.value)).toEqual(VALUES);
  });

  it("gives every method the copy the chooser renders", () => {
    for (const method of START_METHODS) {
      expect(method.title.length).toBeGreaterThan(0);
      expect(method.description.length).toBeGreaterThan(0);
      expect(method.submit.length).toBeGreaterThan(0);
      expect(method.submitPending.length).toBeGreaterThan(0);
      expect(typeof method.icon).not.toBe("undefined");
    }
  });

  // The e2e and every muscle memory around the Git path select on this label.
  it("keeps the Git path's button label unchanged", () => {
    expect(startMethod("git").submit).toBe("Connect repository");
  });
});

describe("defaultStartMethod", () => {
  it("leads with starting from scratch — the fastest path to a live site", () => {
    expect(defaultStartMethod({ canUseStudio: true })).toBe("scratch");
  });

  // Studio is gated to owners/admins, so preselecting "scratch" for a member would tee up
  // a site they could never edit.
  it("falls back to Git for someone who can't open Studio", () => {
    expect(defaultStartMethod({ canUseStudio: false })).toBe("git");
  });
});

describe("startMethod", () => {
  it("resolves every value (the non-null assertion's precondition)", () => {
    for (const value of VALUES) expect(startMethod(value).value).toBe(value);
  });
});

describe("submitLabel", () => {
  it("swaps in the pending label while an action runs", () => {
    expect(submitLabel("scratch", false)).toBe("Create site");
    expect(submitLabel("scratch", true)).toBe("Creating site…");
    expect(submitLabel("git", false)).toBe("Connect repository");
    expect(submitLabel("git", true)).toBe("Connecting…");
  });
});
