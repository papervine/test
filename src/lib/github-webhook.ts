import { createHmac, timingSafeEqual } from "node:crypto";

// Pure helpers for the GitHub push webhook (SPEC §3 auto-sync). Kept out of the route
// and out of any "use server" / server-only module so they unit-test without a server,
// DB, or network — the route is a thin shell over these (mirrors github.ts's split).

/**
 * Verify a webhook delivery's HMAC signature against the App's webhook secret. GitHub
 * signs the **raw** request body (so the route must read req.text() before parsing) and
 * sends it as `X-Hub-Signature-256: sha256=<hex>`. Constant-time compare to avoid a
 * timing oracle; any missing/short/mismatched input is a rejection, never a throw.
 */
export function verifySignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string | undefined,
): boolean {
  if (!signatureHeader || !secret) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch — guard so a wrong-length header is a clean
  // false, and still compare (against `b`) when equal-length to keep the timing flat.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// "refs/heads/main" → "main". A push to a tag ("refs/tags/v1") yields "tags/v1", which
// won't match any site branch — exactly right, since we only sync branch pushes.
export function refToBranch(ref: string): string {
  return ref.replace(/^refs\/heads\//, "");
}

// The slice of a GitHub push payload our sync logic cares about. Extracted by
// parsePushPayload so the route never reaches into the raw JSON shape.
export type PushInfo = {
  owner: string;
  repo: string;
  branch: string;
  headSha: string;
  headMessage: string;
  // Union of added/modified/removed paths across the payload's commits. Empty when the
  // push carries no file lists (GitHub truncates to 20 commits / omits on large pushes)
  // — treated as "unknown, sync to be safe" downstream.
  changedPaths: string[];
};

type RawPush = {
  ref?: string;
  deleted?: boolean;
  after?: string;
  head_commit?: { id?: string; message?: string } | null;
  repository?: { name?: string; owner?: { name?: string; login?: string } };
  commits?: { added?: string[]; modified?: string[]; removed?: string[] }[];
};

// Parse a raw push event into PushInfo, or null if it isn't a syncable branch push
// (a branch deletion, a tag, or a malformed/zero-sha payload). The route turns null
// into a 204 no-op.
export function parsePushPayload(payload: unknown): PushInfo | null {
  const p = payload as RawPush;
  const ref = p.ref;
  const owner = p.repository?.owner?.login ?? p.repository?.owner?.name;
  const repo = p.repository?.name;
  if (!ref || !ref.startsWith("refs/heads/") || !owner || !repo) return null;
  // A branch *deletion* push has deleted:true and an all-zero `after` sha — nothing to sync.
  if (p.deleted) return null;
  const headSha = p.head_commit?.id ?? p.after ?? "";
  if (!headSha || /^0+$/.test(headSha)) return null;

  const changedPaths = (p.commits ?? []).flatMap((c) => [
    ...(c.added ?? []),
    ...(c.modified ?? []),
    ...(c.removed ?? []),
  ]);

  return {
    owner,
    repo,
    branch: refToBranch(ref),
    headSha,
    headMessage: p.head_commit?.message ?? "",
    changedPaths,
  };
}

// Does this push *clearly* touch the site's docs subtree? ADVISORY only — see shouldSyncSite
// for why this can't be a hard skip gate. The push payload's per-commit file lists are
// lossy: GitHub truncates them on large pushes / merges (it caps commits and omits files on
// big diffs), so a "no docs path here" result can be a false negative — exactly what dropped
// a 200+ file docs-PR merge. Returns true on an empty/unknown list and for a repo-root docs
// site (docsPath ""), where the whole repo is the docs root.
export function pushTouchesDocs(changedPaths: string[], docsPath: string): boolean {
  if (changedPaths.length === 0) return true;
  if (!docsPath) return true;
  const prefix = `${docsPath}/`;
  return changedPaths.some((path) => path === docsPath || path.startsWith(prefix));
}

// A site row, reduced to what the match needs. Defined here so the matcher stays pure.
export type SyncCandidate = {
  branch: string;
  docsPath: string;
  lastSyncedCommitSha: string | null;
};

// Of the sites backing the pushed repo, which actually need a sync: same tracked branch,
// and the head isn't already synced (idempotent across GitHub redeliveries).
//
// We deliberately do NOT gate on `pushTouchesDocs`: GitHub's push payload file lists are
// truncated on large pushes/merges, so a "no docs changed" verdict can be a false negative
// that silently drops a real docs change (it dropped a 200+ file docs-PR merge). Missing a
// sync is far worse than running a redundant one — and a redundant sync is cheap and safe:
// it lists the tree + storage, finds nothing to fetch, and no-ops (the reconcile in sync.ts
// makes that a correctness backstop, not a guess). The path filter survives as an advisory
// helper; if monorepo no-op syncs ever clutter the feed, suppress 0-change webhook
// deployments rather than re-introducing a gate that can lose data.
export function shouldSyncSite(push: PushInfo, site: SyncCandidate): boolean {
  if (site.branch !== push.branch) return false;
  if (site.lastSyncedCommitSha === push.headSha) return false;
  return true;
}
