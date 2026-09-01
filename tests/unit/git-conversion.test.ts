import { describe, it, expect } from "vitest";
import { repoEmptiness, planConversion } from "../../src/lib/git-conversion";

// Taking a Papervine-hosted site onto Git (SPEC §10.11). The empty-repo rule is the safety
// property: it's what lets the conversion skip reconciling two docs.json navigations, so
// these tests are about refusing the cases that would have needed a merge.

describe("repoEmptiness", () => {
  it("accepts a branch with no commits at all", () => {
    expect(repoEmptiness(null)).toEqual({ empty: true });
    expect(repoEmptiness([])).toEqual({ empty: true });
  });

  // GitHub's "create repository" checkboxes add these, so requiring a literally-empty repo
  // would reject the exact thing we tell people to make.
  it("accepts a repo holding only the files GitHub's initializer adds", () => {
    expect(repoEmptiness(["README.md"]).empty).toBe(true);
    expect(repoEmptiness(["README.md", "LICENSE", ".gitignore"]).empty).toBe(true);
    expect(repoEmptiness(["readme", "Licence.txt"]).empty).toBe(true);
  });

  it("refuses a repo that already has a docs config, naming it", () => {
    const docs = repoEmptiness(["docs.json", "index.mdx"]);
    expect(docs.empty).toBe(false);
    expect(docs.empty === false && docs.reason).toContain("docs.json");
    const mint = repoEmptiness(["mint.json"]);
    expect(mint.empty === false && mint.reason).toContain("mint.json");
  });

  // Even nested — a repo with docs in a subdirectory is still already a docs site.
  it("finds a docs config in a subdirectory too", () => {
    const res = repoEmptiness(["docs/docs.json"]);
    expect(res.empty).toBe(false);
    expect(res.empty === false && res.reason).toContain("docs.json");
  });

  it("refuses a non-empty repo and says what's in the way", () => {
    const res = repoEmptiness(["src/index.ts", "package.json"]);
    expect(res.empty).toBe(false);
    expect(res.empty === false && res.reason).toContain("package.json");
  });

  it("counts the overflow rather than listing every file", () => {
    const res = repoEmptiness(["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"]);
    expect(res.empty === false && res.reason).toContain("and 2 more");
  });

  // A README at the top level is GitHub's; one inside a folder is something a person wrote.
  it("treats a nested README as real content", () => {
    expect(repoEmptiness(["docs/README.md"]).empty).toBe(false);
  });
});

describe("planConversion", () => {
  const keys = [
    "sites/s1/index.mdx",
    "sites/s1/guides/intro.mdx",
    "sites/s1/docs.json",
  ];

  it("maps storage keys to repo-root paths", () => {
    expect(planConversion("sites/s1/", keys)).toEqual([
      { storageKey: "sites/s1/docs.json", repoPath: "docs.json" },
      { storageKey: "sites/s1/guides/intro.mdx", repoPath: "guides/intro.mdx" },
      { storageKey: "sites/s1/index.mdx", repoPath: "index.mdx" },
    ]);
  });

  it("re-adds docsPath when the site targets a subdirectory", () => {
    expect(planConversion("sites/s1/", ["sites/s1/index.mdx"], "docs")).toEqual([
      { storageKey: "sites/s1/index.mdx", repoPath: "docs/index.mdx" },
    ]);
  });

  // The sidecars are sync bookkeeping — .manifest.json's values are git blob SHAs, which
  // would be nonsense committed into the repo they describe.
  it("never commits the sync sidecars", () => {
    const plan = planConversion("sites/s1/", [
      "sites/s1/.manifest.json",
      "sites/s1/.dimensions.json",
      "sites/s1/index.mdx",
    ]);
    expect(plan.map((f) => f.repoPath)).toEqual(["index.mdx"]);
  });

  it("ignores keys belonging to another site", () => {
    const plan = planConversion("sites/s1/", ["sites/s2/index.mdx", "sites/s1/index.mdx"]);
    expect(plan.map((f) => f.storageKey)).toEqual(["sites/s1/index.mdx"]);
  });

  it("is deterministic, so the initial commit's tree is reproducible", () => {
    const a = planConversion("sites/s1/", [...keys]);
    const b = planConversion("sites/s1/", [...keys].reverse());
    expect(a).toEqual(b);
  });
});
