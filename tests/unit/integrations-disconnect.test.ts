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
