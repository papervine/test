import { describe, it, expect, vi } from "vitest";
import {
  releaseDomain,
  reconcileDomainRemovals,
  type RemovalStore,
} from "@/lib/domain-reconcile";

// Durable domain deletion (SPEC §2): freeing a host enqueues a tombstone and tries the detach
// inline; the tombstone survives a failed call so the reconcile cron retries it. These guard
// that contract with an in-memory store (the DB-bound default is a thin adapter over this).

function memStore(initial: string[] = []): RemovalStore & { rows: Map<string, number> } {
  const rows = new Map<string, number>(initial.map((d) => [d, 0]));
  return {
    rows,
    async enqueue(d) {
      if (!rows.has(d)) rows.set(d, 0);
    },
    async listPending(limit) {
      return [...rows.keys()].slice(0, limit).map((domain) => ({ domain, attempts: rows.get(domain)! }));
    },
    async drop(d) {
      rows.delete(d);
    },
    async bump(d) {
      rows.set(d, (rows.get(d) ?? 0) + 1);
    },
  };
}

describe("releaseDomain", () => {
  it("drops the tombstone when the inline detach succeeds (no leftover work)", async () => {
    const store = memStore();
    await releaseDomain("docs.acme.com", store, async () => true);
    expect(store.rows.has("docs.acme.com")).toBe(false);
  });

  it("keeps the tombstone when the detach fails, so the cron will retry", async () => {
    const store = memStore();
    await releaseDomain("docs.acme.com", store, async () => false);
    expect(store.rows.has("docs.acme.com")).toBe(true);
  });

  it("keeps the tombstone when the detach throws (never lets the failure escape)", async () => {
    const store = memStore();
    await expect(
      releaseDomain("docs.acme.com", store, async () => {
        throw new Error("network");
      }),
    ).resolves.toBeUndefined();
    expect(store.rows.has("docs.acme.com")).toBe(true);
  });
});

describe("reconcileDomainRemovals", () => {
  it("drains the ones Vercel confirms and retries (bumps) the ones it doesn't", async () => {
    const store = memStore(["gone.com", "stuck.com"]);
    const remove = vi.fn(async (d: string) => d === "gone.com"); // stuck.com fails
    const result = await reconcileDomainRemovals(store, remove);

    expect(result).toEqual({ scanned: 2, drained: 1, retried: 1 });
    expect(store.rows.has("gone.com")).toBe(false); // detached → dropped
    expect(store.rows.get("stuck.com")).toBe(1); // failed → attempt bumped, kept for next sweep
  });

  it("treats a thrown detach as a retry, not a crash", async () => {
    const store = memStore(["boom.com"]);
    const result = await reconcileDomainRemovals(store, async () => {
      throw new Error("timeout");
    });
    expect(result).toEqual({ scanned: 1, drained: 0, retried: 1 });
    expect(store.rows.get("boom.com")).toBe(1);
  });

  it("respects the batch limit", async () => {
    const store = memStore(["a.com", "b.com", "c.com"]);
    const remove = vi.fn(async () => true);
    const result = await reconcileDomainRemovals(store, remove, 2);
    expect(result.scanned).toBe(2);
    expect(remove).toHaveBeenCalledTimes(2);
  });
});
