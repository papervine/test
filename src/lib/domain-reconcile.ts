import "server-only";
import { eq, asc, sql } from "drizzle-orm";
import { db } from "./db";
import { domainRemoval } from "./db/app-schema";
import { removeProjectDomain } from "./vercel-domains";

/**
 * Durable custom-domain deletion (SPEC §2). Detaching a host from the Vercel project was a
 * single best-effort call — if it failed, the host orphaned a finite project slot with no
 * retry. Here, freeing a host enqueues a tombstone (`domain_removal`) AND tries the detach
 * inline; the tombstone survives a failed call and the reconcile cron drains it, retrying until
 * Vercel confirms the detach (or 404s). So "delete this domain" always eventually happens.
 *
 * The store is injectable so the loop unit-tests without a database (the repo's unit layer is
 * DB-free); the default binds to Postgres + the real Vercel client.
 */

export type PendingRemoval = { domain: string; attempts: number };

export type RemovalStore = {
  enqueue(domain: string): Promise<void>;
  listPending(limit: number): Promise<PendingRemoval[]>;
  drop(domain: string): Promise<void>;
  bump(domain: string, error: string): Promise<void>;
};

const dbStore: RemovalStore = {
  async enqueue(domain) {
    // Collapse duplicate requests for the same host (domain is the primary key).
    await db.insert(domainRemoval).values({ domain }).onConflictDoNothing();
  },
  async listPending(limit) {
    return db
      .select({ domain: domainRemoval.domain, attempts: domainRemoval.attempts })
      .from(domainRemoval)
      .orderBy(asc(domainRemoval.createdAt))
      .limit(limit);
  },
  async drop(domain) {
    await db.delete(domainRemoval).where(eq(domainRemoval.domain, domain));
  },
  async bump(domain, error) {
    await db
      .update(domainRemoval)
      .set({
        attempts: sql`${domainRemoval.attempts} + 1`,
        lastAttemptAt: new Date(),
        lastError: error.slice(0, 500),
      })
      .where(eq(domainRemoval.domain, domain));
  },
};

type RemoveFn = (domain: string) => Promise<boolean>;

/**
 * Detach a host now, durably. Enqueue a tombstone first, attempt the detach inline, and drop the
 * tombstone only on success — otherwise the reconcile cron retries it later. Call this from every
 * place that frees a host (changing a site's domain, removing it, deleting the site) instead of a
 * bare `removeProjectDomain`, so a transient Vercel failure never strands a domain.
 */
export async function releaseDomain(
  domain: string,
  store: RemovalStore = dbStore,
  removeDomain: RemoveFn = removeProjectDomain,
): Promise<void> {
  await store.enqueue(domain);
  let ok = false;
  try {
    ok = await removeDomain(domain);
  } catch {
    ok = false;
  }
  if (ok) await store.drop(domain);
}

export type ReconcileResult = { scanned: number; drained: number; retried: number };

/**
 * Drain pending domain removals: detach each from Vercel, drop the tombstone on success, bump its
 * attempt count (for backoff/observability) on failure. Idempotent and safe to run on any
 * schedule — driven by the `/api/reconcile/domains` cron.
 */
export async function reconcileDomainRemovals(
  store: RemovalStore = dbStore,
  removeDomain: RemoveFn = removeProjectDomain,
  limit = 100,
): Promise<ReconcileResult> {
  const pending = await store.listPending(limit);
  let drained = 0;
  let retried = 0;
  for (const { domain } of pending) {
    let ok = false;
    let error = "removeProjectDomain returned false (Vercel did not confirm the detach)";
    try {
      ok = await removeDomain(domain);
    } catch (e) {
      ok = false;
      error = (e as Error).message;
    }
    if (ok) {
      await store.drop(domain);
      drained++;
    } else {
      await store.bump(domain, error);
      retried++;
    }
  }
  return { scanned: pending.length, drained, retried };
}
