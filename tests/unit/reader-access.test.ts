import { describe, it, expect } from "vitest";
import { canAccessPage } from "@/lib/reader-auth";
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
