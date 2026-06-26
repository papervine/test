import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  verifySignature,
  refToBranch,
  parsePushPayload,
  pushTouchesDocs,
  shouldSyncSite,
  type PushInfo,
} from "@/lib/github-webhook";

const SECRET = "s3cr3t";
const sign = (body: string) =>
  "sha256=" + createHmac("sha256", SECRET).update(body).digest("hex");

describe("verifySignature", () => {
  it("accepts a correctly-signed body", () => {
    const body = '{"hello":"world"}';
    expect(verifySignature(body, sign(body), SECRET)).toBe(true);
  });
  it("rejects a tampered body", () => {
    const sig = sign('{"hello":"world"}');
    expect(verifySignature('{"hello":"evil"}', sig, SECRET)).toBe(false);
  });
  it("rejects the wrong secret", () => {
    const body = "payload";
    const wrong = "sha256=" + createHmac("sha256", "nope").update(body).digest("hex");
    expect(verifySignature(body, wrong, SECRET)).toBe(false);
  });
  it("rejects a missing signature header or secret", () => {
    expect(verifySignature("x", null, SECRET)).toBe(false);
    expect(verifySignature("x", undefined, SECRET)).toBe(false);
    expect(verifySignature("x", sign("x"), undefined)).toBe(false);
  });
  it("rejects a wrong-length header without throwing", () => {
    expect(verifySignature("x", "sha256=deadbeef", SECRET)).toBe(false);
  });
});

describe("refToBranch", () => {
  it("strips refs/heads/", () => {
    expect(refToBranch("refs/heads/main")).toBe("main");
    expect(refToBranch("refs/heads/feature/x")).toBe("feature/x");
  });
  it("leaves a tag ref untouched (won't match any site branch)", () => {
    expect(refToBranch("refs/tags/v1")).toBe("refs/tags/v1");
  });
});

describe("parsePushPayload", () => {
  const base = {
    ref: "refs/heads/main",
    after: "abc123",
    head_commit: { id: "abc123", message: "docs: update" },
    repository: { name: "starter", owner: { login: "acme", name: "acme" } },
    commits: [{ added: ["docs/a.mdx"], modified: ["docs.json"], removed: [] }],
  };

  it("extracts owner/repo/branch/head + changed paths", () => {
    expect(parsePushPayload(base)).toEqual({
      owner: "acme",
      repo: "starter",
      branch: "main",
      headSha: "abc123",
      headMessage: "docs: update",
      changedPaths: ["docs/a.mdx", "docs.json"],
    });
  });
  it("falls back to owner.name when login is absent", () => {
    const p = { ...base, repository: { name: "starter", owner: { name: "acme" } } };
    expect(parsePushPayload(p)?.owner).toBe("acme");
  });
  it("returns null for a tag push", () => {
    expect(parsePushPayload({ ...base, ref: "refs/tags/v1" })).toBeNull();
  });
  it("returns null for a branch deletion (deleted + zero sha)", () => {
    expect(
      parsePushPayload({
        ...base,
        deleted: true,
        after: "0000000000000000000000000000000000000000",
        head_commit: null,
      }),
    ).toBeNull();
  });
  it("returns null when repo/owner is missing", () => {
    expect(parsePushPayload({ ref: "refs/heads/main", after: "x" })).toBeNull();
  });
  it("tolerates a payload with no commits list (large/truncated push)", () => {
    const p = { ...base, commits: undefined };
    expect(parsePushPayload(p)?.changedPaths).toEqual([]);
  });
});

describe("pushTouchesDocs", () => {
  it("matches a path inside the docs subdir", () => {
    expect(pushTouchesDocs(["docs/intro.mdx"], "docs")).toBe(true);
  });
  it("skips a push that only touches files outside the docs subdir", () => {
    expect(pushTouchesDocs(["src/index.ts", "README.md"], "docs")).toBe(false);
  });
  it("treats an empty change list as 'sync to be safe'", () => {
    expect(pushTouchesDocs([], "docs")).toBe(true);
  });
  it("always matches for a repo-root docs site", () => {
    expect(pushTouchesDocs(["src/index.ts"], "")).toBe(true);
  });
  it("does not treat a sibling prefix as inside (docs vs docs-old)", () => {
    expect(pushTouchesDocs(["docs-old/x.mdx"], "docs")).toBe(false);
  });
});

describe("shouldSyncSite", () => {
  const push: PushInfo = {
    owner: "acme",
    repo: "starter",
    branch: "main",
    headSha: "abc123",
    headMessage: "x",
    changedPaths: ["docs/a.mdx"],
  };

  it("syncs a matching branch whose head we haven't synced", () => {
    expect(shouldSyncSite(push, { branch: "main", docsPath: "docs", lastSyncedCommitSha: "old" })).toBe(true);
  });
  it("skips a different branch", () => {
    expect(shouldSyncSite(push, { branch: "next", docsPath: "docs", lastSyncedCommitSha: null })).toBe(false);
  });
  it("skips when the head sha is already synced (redelivery idempotency)", () => {
    expect(shouldSyncSite(push, { branch: "main", docsPath: "docs", lastSyncedCommitSha: "abc123" })).toBe(false);
  });
  it("syncs even when the payload shows no docs paths (file lists are truncatable — never drop a sync)", () => {
    // The push payload's file lists are lossy on large merges, so a "no docs here" verdict
    // can be a false negative. We sync anyway; a redundant sync is a cheap no-op, a missed
    // one silently strands a docs change (the 200+ file merge that didn't sync).
    const offDocs = { ...push, changedPaths: ["src/x.ts"] };
    expect(shouldSyncSite(offDocs, { branch: "main", docsPath: "docs", lastSyncedCommitSha: null })).toBe(true);
  });
});
