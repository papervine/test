import { describe, it, expect, vi, beforeEach } from "vitest";

// createSession's only interesting logic is what happens when the insert conflicts — a real
// Postgres call, so it's exercised here against a minimal drizzle stand-in rather than a real
// DB (matching the mock-db pattern in dashboard-context.test.ts), pinning the error-shape
// detection and the fallback path without needing docker Postgres up.

const state = {
  insertError: null as Error | null,
  insertedRow: { id: "fresh-id", siteId: "s1", branch: "main" },
  existingOpenRow: { id: "winner-id", siteId: "s1", branch: "main" },
};

function pgUniqueViolation(constraint: string): Error {
  const err = new Error(`Failed query: insert into "editor_session" ...`);
  (err as unknown as { cause: unknown }).cause = { code: "23505", constraint_name: constraint };
  return err;
}

vi.mock("@/lib/db", () => ({
  db: {
    insert: () => {
      const chain: Record<string, unknown> = {};
      chain.values = () => chain;
      chain.returning = () =>
        state.insertError ? Promise.reject(state.insertError) : Promise.resolve([state.insertedRow]);
      return chain;
    },
    select: () => {
      const chain: Record<string, unknown> = {};
      for (const m of ["from", "where"]) chain[m] = () => chain;
      chain.limit = () => Promise.resolve([state.existingOpenRow]);
      return chain;
    },
  },
}));

import { createSession } from "@/lib/draft-store";

beforeEach(() => {
  state.insertError = null;
});

const input = { siteId: "s1", branch: "main", baseBranch: "main", baseCommitSha: "sha1" };

describe("createSession", () => {
  it("returns the freshly-inserted row when there's no conflict", async () => {
    const row = await createSession(input);
    expect(row.id).toBe("fresh-id");
  });

  it("hands back the winner's row instead of 500ing when a concurrent checkout wins the race", async () => {
    // Regression: the partial unique index (one OPEN session per site+branch) lets two
    // simultaneous checkouts of the same never-before-opened branch race — one insert wins,
    // the other must gracefully adopt the winner's row rather than crash the request.
    state.insertError = pgUniqueViolation("editorSession_site_branch_idx");
    const row = await createSession(input);
    expect(row.id).toBe("winner-id");
  });

  it("rethrows a duplicate-key error from an unrelated constraint", async () => {
    state.insertError = pgUniqueViolation("some_other_idx");
    await expect(createSession(input)).rejects.toThrow();
  });

  it("rethrows a non-unique-violation error untouched", async () => {
    state.insertError = new Error("connection reset");
    await expect(createSession(input)).rejects.toThrow("connection reset");
  });
});
