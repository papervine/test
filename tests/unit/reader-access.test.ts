import { describe, it, expect, beforeAll } from "vitest";
import { canAccessPage } from "@/lib/reader-auth";
import { entitlementKey } from "@/lib/reader-access";
import { mintReaderSession } from "@/lib/reader-session";
import { parseDocsConfig } from "@papervine/renderer/lib/config";
import { contentContext, parsePage, type ContentSource } from "@papervine/renderer/lib/content";
import { buildNav, type NavLeaf, type NavNode, type PageAccess } from "@papervine/renderer/lib/nav";

describe("canAccessPage (per-page group gate, SPEC §11.2)", () => {
  it("allows a page with no groups", () => {
    expect(canAccessPage(undefined, undefined, [])).toBe(true);
    expect(canAccessPage([], undefined, [])).toBe(true);
  });

  it("allows a public page even when it lists groups", () => {
    expect(canAccessPage(["admin"], true, [])).toBe(true);
  });

  it("allows when the reader is in at least one listed group", () => {
    expect(canAccessPage(["admin"], false, ["admin"])).toBe(true);
    expect(canAccessPage(["admin", "beta"], false, ["beta"])).toBe(true);
  });

  it("denies when the reader is in none of the listed groups", () => {
    expect(canAccessPage(["admin"], false, ["beta"])).toBe(false);
    expect(canAccessPage(["admin"], undefined, [])).toBe(false); // password reader (no groups)
  });

  // Auth is DEFAULT-DENY per page: with auth on, a page needs a session unless it says
  // `public: true`. These pin the anonymous half, which is what makes "some pages public,
  // the rest protected" work on one site.
  describe("anonymous readers (signedIn = false)", () => {
    it("allows only pages explicitly marked public", () => {
      expect(canAccessPage(undefined, true, [], false)).toBe(true);
      expect(canAccessPage(["admin"], true, [], false)).toBe(true); // public wins over groups
    });

    it("denies an ungated page — the difference from a signed-in reader", () => {
      // The regression this guards: treating "anonymous" as "authenticated with no groups"
      // would make every page lacking a `groups:` line world-readable the moment auth was
      // switched on. Same arguments, opposite answers — only `signedIn` differs.
      expect(canAccessPage(undefined, undefined, [], false)).toBe(false);
      expect(canAccessPage(undefined, undefined, [], true)).toBe(true);
    });

    it("denies a group-gated page regardless of the groups claimed", () => {
      expect(canAccessPage(["admin"], undefined, [], false)).toBe(false);
      expect(canAccessPage(["admin"], undefined, ["admin"], false)).toBe(false);
    });
  });
});

// Nav hiding: pages the reader can't access are dropped from the sidebar entirely (so a
// non-member never sees that a restricted page exists — no client-side leak).
function fixtureSource(): { source: ContentSource; config: ReturnType<typeof parseDocsConfig>["config"] } {
  const bodies: Record<string, string> = {
    "intro": "---\ntitle: Intro\n---\nhi",
    "admin/users": "---\ntitle: Users\ngroups: [admin]\n---\nsecret",
    "admin/audit": "---\ntitle: Audit\ngroups: [admin, security]\n---\nsecret",
    "billing": "---\ntitle: Billing\ngroups: [billing]\npublic: true\n---\nopen",
  };
  const { config } = parseDocsConfig({
    name: "T",
    navigation: { groups: [{ group: "Docs", pages: Object.keys(bodies) }] },
  });
  return {
    config,
    source: {
      async loadConfig() {
        return config;
      },
      async loadPage(slug) {
        return bodies[slug] ? parsePage(slug, bodies[slug]) : null;
      },
      async listPageSlugs() {
        return Object.keys(bodies);
      },
    },
  };
}

function hrefs(nodes: (NavLeaf | NavNode)[]): string[] {
  return nodes.flatMap((n) => ("href" in n ? [n.href] : hrefs(n.items)));
}

describe("buildNav hides pages the reader can't access", () => {
  it("omits grouped pages a non-member can't see; keeps ungated and public ones", async () => {
    const { source, config } = fixtureSource();
    const canAccess: PageAccess = (fm) => canAccessPage(fm.groups, fm.public, ["billing"]);
    const sections = await contentContext.run(source, () => buildNav(config, "", canAccess));
    const links = hrefs(sections.flatMap((s) => s.nodes));
    expect(links).toContain("/intro"); // ungated
    expect(links).toContain("/billing"); // public despite a group
    expect(links).not.toContain("/admin/users"); // admin-only, reader isn't admin
    expect(links).not.toContain("/admin/audit");
  });

  it("shows everything to a member of the gating groups", async () => {
    const { source, config } = fixtureSource();
    const canAccess: PageAccess = (fm) => canAccessPage(fm.groups, fm.public, ["admin", "security"]);
    const sections = await contentContext.run(source, () => buildNav(config, "", canAccess));
    const links = hrefs(sections.flatMap((s) => s.nodes));
    expect(links).toEqual(
      expect.arrayContaining(["/intro", "/admin/users", "/admin/audit", "/billing"]),
    );
  });

  it("with no predicate (default), shows all pages — unchanged behavior for non-auth sites", async () => {
    const { source, config } = fixtureSource();
    const sections = await contentContext.run(source, () => buildNav(config));
    const links = hrefs(sections.flatMap((s) => s.nodes));
    expect(links).toHaveLength(4);
  });
});

// Container pruning: a group or tab whose every page is filtered out disappears entirely —
// no bare label, no teasing empty "Internal" tab. Access stays at the page; containers derive.
function tabsSource() {
  const bodies: Record<string, string> = {
    "intro": "---\ntitle: Intro\n---\nhi",
    "internal/overview": "---\ntitle: Overview\ngroups: [admin]\n---\nx",
    "internal/settings": "---\ntitle: Settings\ngroups: [admin]\n---\nx",
  };
  const { config } = parseDocsConfig({
    name: "T",
    navigation: {
      tabs: [
        { tab: "Docs", groups: [{ group: "Start", pages: ["intro"] }] },
        { tab: "Internal", groups: [{ group: "Team", pages: ["internal/overview", "internal/settings"] }] },
      ],
    },
  });
  return {
    config,
    source: {
      async loadConfig() {
        return config;
      },
      async loadPage(slug: string) {
        return bodies[slug] ? parsePage(slug, bodies[slug]) : null;
      },
      async listPageSlugs() {
        return Object.keys(bodies);
      },
    } as ContentSource,
  };
}

describe("buildNav prunes empty groups and tabs after access filtering", () => {
  it("drops the whole Internal tab for a non-member (every page gated)", async () => {
    const { source, config } = tabsSource();
    const canAccess: PageAccess = (fm) => canAccessPage(fm.groups, fm.public, []); // no groups
    const sections = await contentContext.run(source, () => buildNav(config, "", canAccess));
    const tabs = sections.map((s) => s.tab);
    expect(tabs).toContain("Docs");
    expect(tabs).not.toContain("Internal"); // fully gated → tab pruned
  });

  it("keeps the Internal tab (and its group) for an admin", async () => {
    const { source, config } = tabsSource();
    const canAccess: PageAccess = (fm) => canAccessPage(fm.groups, fm.public, ["admin"]);
    const sections = await contentContext.run(source, () => buildNav(config, "", canAccess));
    const internal = sections.find((s) => s.tab === "Internal");
    expect(internal).toBeDefined();
    expect(hrefs(internal!.nodes)).toEqual(["/internal/overview", "/internal/settings"]);
  });

  it("prunes an empty group but keeps sibling non-empty groups", async () => {
    // Non-member sees Docs/Start (intro) but the Internal tab is gone — so within a tab the
    // empty group never renders as a bare 'Team' label.
    const { source, config } = tabsSource();
    const canAccess: PageAccess = (fm) => canAccessPage(fm.groups, fm.public, []);
    const sections = await contentContext.run(source, () => buildNav(config, "", canAccess));
    const groups = sections.flatMap((s) => s.nodes).flatMap((n) => ("group" in n ? [n.group] : []));
    expect(groups).toContain("Start");
    expect(groups).not.toContain("Team");
  });
});

describe("entitlementKey (per-group cache key, SPEC §11.2 move ②/③)", () => {
  // mintReaderSession encrypts the cookie with this key; readerSession decrypts it.
  beforeAll(() => {
    process.env.PAPERVINE_ENCRYPTION_KEY = Buffer.from(
      "0123456789abcdef0123456789abcdef",
    ).toString("base64");
  });

  it("is 'public' for an auth-off site (one shared variant), regardless of cookie", () => {
    expect(entitlementKey({ authEnabled: false, id: "s1" }, undefined)).toBe("public");
    expect(
      entitlementKey({ authEnabled: false, id: "s1" }, mintReaderSession("s1", Date.now(), { groups: ["admin"] })),
    ).toBe("public");
  });

  it("is 'anon' for a gated site with no (or password) session", () => {
    expect(entitlementKey({ authEnabled: true, id: "s1" }, undefined)).toBe("anon");
    expect(entitlementKey({ authEnabled: true, id: "s1" }, mintReaderSession("s1"))).toBe("anon");
  });

  it("keys on the sorted group set, so group ORDER never splits the cache", () => {
    // The cache-correctness property: [b,a] and [a,b] are the same entitlement → one cache entry.
    const ab = entitlementKey({ authEnabled: true, id: "s1" }, mintReaderSession("s1", Date.now(), { groups: ["a", "b"] }));
    const ba = entitlementKey({ authEnabled: true, id: "s1" }, mintReaderSession("s1", Date.now(), { groups: ["b", "a"] }));
    expect(ab).toBe("a,b");
    expect(ba).toBe("a,b");
  });

  it("gives distinct keys to distinct group sets", () => {
    const admin = entitlementKey({ authEnabled: true, id: "s1" }, mintReaderSession("s1", Date.now(), { groups: ["admin"] }));
    const beta = entitlementKey({ authEnabled: true, id: "s1" }, mintReaderSession("s1", Date.now(), { groups: ["beta"] }));
    expect(admin).toBe("admin");
    expect(admin).not.toBe(beta);
  });

  it("treats a cookie minted for another site as no session (site-bound) → 'anon'", () => {
    const otherSiteCookie = mintReaderSession("s2", Date.now(), { groups: ["admin"] });
    expect(entitlementKey({ authEnabled: true, id: "s1" }, otherSiteCookie)).toBe("anon");
  });
});
