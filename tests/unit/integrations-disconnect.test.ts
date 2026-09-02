import { describe, it, expect, vi, beforeEach } from "vitest";

// Disconnecting a source (SPEC §10.2). The ordering here is the part worth pinning: the
// grant is revoked at Nango FIRST, and our row is dropped only if that succeeded — so a
// failed revoke can never leave a live grant we've forgotten we hold. "Already gone"
// counts as success, because convergence beats bookkeeping.

const deleteConnection = vi.fn();
const dbDelete = vi.fn();
const selectRows: unknown[] = [];

vi.mock("@nangohq/node", () => ({
  Nango: class {
    deleteConnection = deleteConnection;
  },
}));

vi.mock("../../src/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => selectRows }),
      }),
    }),
    delete: (...args: unknown[]) => {
      dbDelete(...args);
      return { where: async () => undefined };
    },
  },
}));

const ROW = {
  id: "ic1",
  organizationId: "org1",
  provider: "google-drive",
  nangoConnectionId: "conn_1",
  status: "active",
};

async function load() {
  return import("../../src/lib/integrations/nango");
}

beforeEach(() => {
  vi.resetModules();
  deleteConnection.mockReset();
  dbDelete.mockReset();
  selectRows.length = 0;
  process.env.NANGO_SECRET_KEY = "test-key";
});

describe("disconnectConnection", () => {
  it("revokes at Nango, then drops our row", async () => {
    selectRows.push(ROW);
    deleteConnection.mockResolvedValue(undefined);
    const { disconnectConnection } = await load();

    expect(await disconnectConnection("org1", "google-drive")).toEqual({ ok: true });
    expect(deleteConnection).toHaveBeenCalledWith("google-drive", "conn_1");
    expect(dbDelete).toHaveBeenCalledTimes(1);
  });

  it("KEEPS the row when the revoke fails — never orphan a live grant", async () => {
    selectRows.push(ROW);
    deleteConnection.mockRejectedValue(new Error("nango unavailable"));
    const { disconnectConnection } = await load();

    expect(await disconnectConnection("org1", "google-drive")).toEqual({
      error: "nango unavailable",
    });
    expect(dbDelete).not.toHaveBeenCalled();
  });

  it("treats an already-deleted connection as success", async () => {
    selectRows.push(ROW);
    deleteConnection.mockRejectedValue(new Error("Request failed: 404 not found"));
    const { disconnectConnection } = await load();

    expect(await disconnectConnection("org1", "google-drive")).toEqual({ ok: true });
    // Gone on their side and gone on ours is the state we wanted either way.
    expect(dbDelete).toHaveBeenCalledTimes(1);
  });

  it("drops the row without calling Nango when no backend is configured", async () => {
    // A deployment that lost its key must still be able to detach a source — otherwise
    // the row is undeletable and the gallery shows a connection nobody can remove.
    delete process.env.NANGO_SECRET_KEY;
    selectRows.push(ROW);
    const { disconnectConnection } = await load();

    expect(await disconnectConnection("org1", "google-drive")).toEqual({ ok: true });
    expect(deleteConnection).not.toHaveBeenCalled();
    expect(dbDelete).toHaveBeenCalledTimes(1);
  });

  it("is a no-op for a provider that isn't connected", async () => {
    const { disconnectConnection } = await load();
    expect(await disconnectConnection("org1", "google-drive")).toEqual({ ok: true });
    expect(deleteConnection).not.toHaveBeenCalled();
    expect(dbDelete).not.toHaveBeenCalled();
  });
});

// Regression: what an operator is TOLD when Nango rejects a request.
//
// Found live (2026-09-02) wiring up the first real account: connecting failed with
// "Request failed with status code 400" — axios's message, technically true and totally
// unactionable — while Nango's response body said exactly what was wrong ("Integration
// does not exist") and named the field. Cost a debugging session that a readable error
// would have ended immediately.
describe("nangoErrorMessage", () => {
  // The real body Nango returned for a missing integration.
  const integrationMissing = {
    response: {
      status: 400,
      data: {
        error: {
          code: "invalid_body",
          errors: [
            { code: "custom", message: "Integration does not exist", path: ["allowed_integrations", 0] },
          ],
        },
      },
    },
  };

  it("turns the missing-integration 400 into the actual fix, naming the key", async () => {
    const { nangoErrorMessage } = await load();
    const msg = nangoErrorMessage(integrationMissing, { providerConfigKey: "google-drive" });
    expect(msg).toContain('"google-drive"');
    expect(msg).toMatch(/create it in the nango dashboard/i);
    // The useless axios text must not be what surfaces.
    expect(msg).not.toMatch(/status code 400/i);
  });

  it("surfaces a structured validation message with its code", async () => {
    const { nangoErrorMessage } = await load();
    expect(
      nangoErrorMessage({
        response: { data: { error: { code: "invalid_body", message: "end_user.id is required" } } },
      }),
    ).toBe("end_user.id is required (invalid_body)");
  });

  it("prefers the field-level error over the envelope message", async () => {
    const { nangoErrorMessage } = await load();
    expect(
      nangoErrorMessage({
        response: {
          data: { error: { message: "Invalid body", errors: [{ message: "bad allowed_integrations" }] } },
        },
      }),
    ).toContain("bad allowed_integrations");
  });

  it("falls back to the error's own message, then to a default", async () => {
    const { nangoErrorMessage } = await load();
    expect(nangoErrorMessage(new Error("socket hang up"))).toBe("socket hang up");
    expect(nangoErrorMessage(null)).toBe("Nango request failed.");
    expect(nangoErrorMessage({ response: { data: "html error page" } })).toBe(
      "Nango request failed.",
    );
  });

  it("doesn't claim a missing integration when there's no key for context", async () => {
    const { nangoErrorMessage } = await load();
    // Without the key the advice can't name what to create, so report the raw complaint.
    expect(nangoErrorMessage(integrationMissing)).toContain("Integration does not exist");
  });
});
