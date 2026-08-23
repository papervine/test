import { describe, it, expect } from "vitest";
import { parseDocsConfig } from "@papervine/renderer/lib/config";
import {
  addGroup,
  addPageToGroup,
  addTab,
  canonicalSlug,
  IMPLICIT_TAB_NAME,
  findGroup,
  movePage,
  navPageSlugs,
  navRoot,
  reorderGroup,
  newPageContent,
  newPageSlug,
  unlistedPageSlugs,
} from "@/lib/nav-edit";

// The nav tree's "+" menu (New page / Add existing page / New group) mutates docs.json. These
// are the pure mutators; the server actions are read → mutate → saveDraft around them.

const config = () => ({
  name: "Docs",
  navigation: {
    tabs: [
      {
        tab: "Guides",
        groups: [
          { group: "Get Started", pages: ["index", "quickstart"] },
          { group: "Deep", groups: [{ group: "Nested", pages: ["deep/one"] }] },
        ],
      },
    ],
  },
});

describe("navRoot", () => {
  it("unwraps a `navigation` key, or takes the object as the nav itself", () => {
    expect(navRoot({ navigation: { groups: [] } })).toEqual({ groups: [] });
    expect(navRoot({ groups: [] })).toEqual({ groups: [] });
  });
});

describe("findGroup", () => {
  it("finds a group at any depth, including inside tabs and nested groups", () => {
    const c = config();
    expect(findGroup(navRoot(c), "Get Started")?.group).toBe("Get Started");
    expect(findGroup(navRoot(c), "Nested")?.group).toBe("Nested");
  });

  it("returns null for an unknown group rather than throwing", () => {
    expect(findGroup(navRoot(config()), "Nope")).toBeNull();
  });
});

describe("addPageToGroup", () => {
  it("appends the slug to the group's pages", () => {
    const c = config();
    expect(addPageToGroup(c, "Get Started", "guides/new")).toBe(true);
    expect(findGroup(navRoot(c), "Get Started")!.pages).toEqual(["index", "quickstart", "guides/new"]);
  });

  it("creates `pages` on a group that only had nested groups", () => {
    const c = config();
    expect(addPageToGroup(c, "Deep", "deep/two")).toBe(true);
    const deep = findGroup(navRoot(c), "Deep")!;
    expect(deep.pages).toEqual(["deep/two"]);
    // ...without disturbing the nested groups it already had.
    expect(Array.isArray(deep.groups)).toBe(true);
  });

  it("strips a leading slash so the nav entry matches the renderer's slug form", () => {
    const c = config();
    addPageToGroup(c, "Get Started", "/leading");
    expect(findGroup(navRoot(c), "Get Started")!.pages).toContain("leading");
  });

  it("refuses a duplicate instead of writing the page into the nav twice", () => {
    const c = config();
    expect(addPageToGroup(c, "Get Started", "quickstart")).toBe(false);
    expect(addPageToGroup(c, "Get Started", "/quickstart")).toBe(false);
    expect(findGroup(navRoot(c), "Get Started")!.pages).toEqual(["index", "quickstart"]);
  });

  it("reports a missing group rather than creating one", () => {
    const c = config();
    expect(addPageToGroup(c, "Ghost", "x")).toBe(false);
    expect(findGroup(navRoot(c), "Ghost")).toBeNull();
  });
});

describe("addGroup", () => {
  it("appends to the first tab's groups when the nav is tab-shaped", () => {
    const c = config();
    expect(addGroup(c, "Fresh")).toBe(true);
    const groups = (navRoot(c) as Record<string, unknown[]>).tabs[0] as Record<string, unknown[]>;
    expect(groups.groups.map((g) => (g as Record<string, unknown>).group)).toEqual([
      "Get Started",
      "Deep",
      "Fresh",
    ]);
  });

  it("appends to a top-level groups array when there are no tabs", () => {
    const c = { navigation: { groups: [{ group: "A", pages: ["a"] }] } };
    expect(addGroup(c, "B")).toBe(true);
    expect(c.navigation.groups.map((g) => g.group)).toEqual(["A", "B"]);
  });

  it("creates the groups array on a nav that has neither", () => {
    const c: Record<string, unknown> = { navigation: {} };
    expect(addGroup(c, "First")).toBe(true);
    expect((c.navigation as Record<string, unknown[]>).groups).toEqual([{ group: "First", pages: [] }]);
  });

  it("nests under a parent group when asked", () => {
    const c = config();
    expect(addGroup(c, "Child", "Get Started")).toBe(true);
    const parent = findGroup(navRoot(c), "Get Started")!;
    expect((parent.groups as { group: string }[])[0].group).toBe("Child");
    // The parent's own pages are untouched.
    expect(parent.pages).toEqual(["index", "quickstart"]);
  });

  it("refuses a duplicate name — names are how every other action addresses a group", () => {
    const c = config();
    expect(addGroup(c, "Get Started")).toBe(false);
    expect(addGroup(c, "Nested")).toBe(false);
  });

  it("reports a missing parent rather than falling back to the top level", () => {
    const c = config();
    expect(addGroup(c, "Orphan", "Ghost")).toBe(false);
    expect(findGroup(navRoot(c), "Orphan")).toBeNull();
  });

  // The whole point of the "+" is to build a site up from nothing, so the empty case matters.
  it("a group added to an empty nav still parses as a valid config", () => {
    const c: Record<string, unknown> = { name: "D", navigation: {} };
    addGroup(c, "Start");
    addPageToGroup(c, "Start", "index");
    // Round-trip through JSON the way the action does (saveDraft writes a string), then parse
    // the object — parseDocsConfig takes the parsed object, not the raw text.
    const parsed = parseDocsConfig(JSON.parse(JSON.stringify(c)));
    expect(parsed.warnings).toEqual([]);
  });
});

// `tabs` and top-level `groups` are ALTERNATIVES, not siblings — buildNav reads one branch or
// the other (confirmed against the docs.json JSON Schema). So adding a first tab to a tab-less
// site has to carry the existing content into it; a naive `tabs = [newTab]` would make every
// existing group silently vanish from the rendered site.
describe("addTab", () => {
  it("appends to an existing tabs array", () => {
    const c = config();
    expect(addTab(c, "API")).toEqual({ ok: true, converted: false });
    const tabs = (navRoot(c) as { tabs: { tab: string }[] }).tabs;
    expect(tabs.map((t) => t.tab)).toEqual(["Guides", "API"]);
    expect(tabs[1]).toEqual({ tab: "API", groups: [] });
  });

  it("refuses a duplicate tab name", () => {
    const c = config();
    expect(addTab(c, "Guides")).toEqual({ ok: false, converted: false });
    expect((navRoot(c) as { tabs: unknown[] }).tabs).toHaveLength(1);
  });

  it("converts a tab-less nav, carrying existing groups into a first tab", () => {
    const c = {
      navigation: {
        groups: [
          { group: "A", pages: ["a"] },
          { group: "B", pages: ["b"] },
        ],
      },
    } as Record<string, unknown>;
    expect(addTab(c, "API")).toEqual({ ok: true, converted: true });
    const nav = navRoot(c) as Record<string, unknown>;
    // Root containers moved, not copied — leaving them would make buildNav ignore them while
    // they linger in the file, and a later edit would touch the wrong copy.
    expect(nav.groups).toBeUndefined();
    const tabs = nav.tabs as { tab: string; groups?: { group: string }[] }[];
    expect(tabs.map((t) => t.tab)).toEqual([IMPLICIT_TAB_NAME, "API"]);
    expect(tabs[0].groups!.map((g) => g.group)).toEqual(["A", "B"]);
    expect(tabs[1].groups).toEqual([]);
  });

  it("carries every root container, not just groups", () => {
    const c = {
      navigation: {
        pages: ["loose"],
        groups: [{ group: "A", pages: ["a"] }],
        anchors: [{ anchor: "Ext", href: "https://x.test" }],
        dropdowns: [{ dropdown: "D", href: "https://y.test" }],
      },
    } as Record<string, unknown>;
    addTab(c, "API");
    const first = (navRoot(c) as { tabs: Record<string, unknown>[] }).tabs[0];
    expect(Object.keys(first)).toEqual(["tab", "groups", "pages", "anchors", "dropdowns"]);
    const nav = navRoot(c) as Record<string, unknown>;
    for (const k of ["groups", "pages", "anchors", "dropdowns"]) expect(nav[k]).toBeUndefined();
  });

  it("makes the new tab the only tab when there was no content at all", () => {
    const c = { navigation: {} } as Record<string, unknown>;
    expect(addTab(c, "First")).toEqual({ ok: true, converted: false });
    expect((navRoot(c) as { tabs: unknown[] }).tabs).toEqual([{ tab: "First", groups: [] }]);
  });

  // The refusal must happen BEFORE the move: bailing halfway would delete the root containers
  // without writing any tabs, i.e. wipe the navigation.
  it("refuses the implicit tab's own name without gutting the navigation", () => {
    const c = { navigation: { groups: [{ group: "A", pages: ["a"] }] } } as Record<string, unknown>;
    expect(addTab(c, IMPLICIT_TAB_NAME)).toEqual({ ok: false, converted: false });
    const nav = navRoot(c) as Record<string, unknown>;
    expect(nav.groups).toEqual([{ group: "A", pages: ["a"] }]);
    expect(nav.tabs).toBeUndefined();
  });

  it("a converted nav still parses without warnings, and both tabs survive a JSON round-trip", () => {
    const c = { name: "D", navigation: { groups: [{ group: "A", pages: ["a"] }] } } as Record<string, unknown>;
    addTab(c, "API");
    const parsed = parseDocsConfig(JSON.parse(JSON.stringify(c)));
    expect(parsed.warnings).toEqual([]);
  });

  // After converting, the group helpers must still find groups at their new depth.
  it("leaves groups reachable by name after a conversion", () => {
    const c = { navigation: { groups: [{ group: "A", pages: ["a"] }] } } as Record<string, unknown>;
    addTab(c, "API");
    expect(findGroup(navRoot(c), "A")?.group).toBe("A");
    expect(addPageToGroup(c, "A", "second")).toBe(true);
    expect(findGroup(navRoot(c), "A")!.pages).toEqual(["a", "second"]);
    // And a new group lands in the first tab, not adrift at the root.
    expect(addGroup(c, "Fresh")).toBe(true);
    const tabs = (navRoot(c) as { tabs: Record<string, unknown>[] }).tabs;
    expect((tabs[0].groups as { group: string }[]).map((g) => g.group)).toEqual(["A", "Fresh"]);
  });
});

// Drag-and-drop in the nav tree. Every one of these is a "did we lose a page?" test: the move is
// a splice-out/splice-in, so an off-by-one or a bad address drops an entry on the floor.
describe("movePage", () => {
  const nav = () =>
    ({
      navigation: {
        groups: [
          { group: "A", pages: ["a1", "a2", "a3"] },
          { group: "B", pages: ["b1"] },
          { group: "Empty" },
        ],
      },
    }) as Record<string, unknown>;
  const pages = (c: unknown, g: string) => findGroup(navRoot(c), g)!.pages;

  it("reorders within a group", () => {
    const c = nav();
    expect(movePage(c, { group: "A", index: 0 }, { group: "A", index: 2 })).toBe(true);
    expect(pages(c, "A")).toEqual(["a2", "a3", "a1"]);
  });

  it("reorders upward within a group", () => {
    const c = nav();
    expect(movePage(c, { group: "A", index: 2 }, { group: "A", index: 0 })).toBe(true);
    expect(pages(c, "A")).toEqual(["a3", "a1", "a2"]);
  });

  it("moves a page to another group at the requested position", () => {
    const c = nav();
    expect(movePage(c, { group: "A", index: 1 }, { group: "B", index: 0 })).toBe(true);
    expect(pages(c, "A")).toEqual(["a1", "a3"]);
    expect(pages(c, "B")).toEqual(["a2", "b1"]);
  });

  it("moves into a group that has no pages array yet", () => {
    const c = nav();
    expect(movePage(c, { group: "A", index: 0 }, { group: "Empty", index: 0 })).toBe(true);
    expect(pages(c, "Empty")).toEqual(["a1"]);
    expect(pages(c, "A")).toEqual(["a2", "a3"]);
  });

  it("clamps a drop index past the end instead of leaving a hole", () => {
    const c = nav();
    // The drop index comes from the pre-removal list, so a same-group downward move can be one
    // past the end after the splice. Array#splice would happily create a sparse slot.
    expect(movePage(c, { group: "A", index: 0 }, { group: "A", index: 99 })).toBe(true);
    expect(pages(c, "A")).toEqual(["a2", "a3", "a1"]);
    expect((pages(c, "A") as unknown[]).every((p) => p !== undefined)).toBe(true);
  });

  it("keeps the total page count constant — nothing is ever dropped", () => {
    const c = nav();
    const before = navPageSlugs(c).length;
    movePage(c, { group: "A", index: 2 }, { group: "B", index: 1 });
    movePage(c, { group: "B", index: 0 }, { group: "Empty", index: 0 });
    expect(navPageSlugs(c).length).toBe(before);
  });

  it("preserves an object entry rather than stringifying it", () => {
    // An OpenAPI selector or a page with its own href is an object, not a slug string.
    const c = {
      navigation: {
        groups: [
          { group: "A", pages: [{ openapi: "GET /pets" }, "plain"] },
          { group: "B", pages: [] },
        ],
      },
    } as Record<string, unknown>;
    expect(movePage(c, { group: "A", index: 0 }, { group: "B", index: 0 })).toBe(true);
    expect(pages(c, "B")).toEqual([{ openapi: "GET /pets" }]);
  });

  it("refuses an out-of-range source index without mutating anything", () => {
    const c = nav();
    expect(movePage(c, { group: "A", index: 5 }, { group: "B", index: 0 })).toBe(false);
    expect(movePage(c, { group: "A", index: -1 }, { group: "B", index: 0 })).toBe(false);
    expect(pages(c, "A")).toEqual(["a1", "a2", "a3"]);
    expect(pages(c, "B")).toEqual(["b1"]);
  });

  it("refuses an unknown group on either end", () => {
    const c = nav();
    expect(movePage(c, { group: "Ghost", index: 0 }, { group: "B", index: 0 })).toBe(false);
    expect(movePage(c, { group: "A", index: 0 }, { group: "Ghost", index: 0 })).toBe(false);
    expect(pages(c, "A")).toEqual(["a1", "a2", "a3"]);
  });

  it("moves across tabs, since groups are addressed by name at any depth", () => {
    const c = config();
    expect(movePage(c, { group: "Get Started", index: 0 }, { group: "Nested", index: 0 })).toBe(true);
    expect(pages(c, "Get Started")).toEqual(["quickstart"]);
    expect(pages(c, "Nested")).toEqual(["index", "deep/one"]);
  });
});

describe("reorderGroup", () => {
  const nav = () =>
    ({
      navigation: {
        groups: [
          { group: "A", pages: ["a"] },
          { group: "B", pages: ["b"] },
          { group: "C", pages: ["c"] },
        ],
      },
    }) as Record<string, unknown>;
  const names = (c: unknown) =>
    ((navRoot(c) as { groups: { group: string }[] }).groups ?? []).map((g) => g.group);

  it("moves a group down", () => {
    const c = nav();
    expect(reorderGroup(c, "A", 2)).toBe(true);
    expect(names(c)).toEqual(["B", "C", "A"]);
  });

  it("moves a group up", () => {
    const c = nav();
    expect(reorderGroup(c, "C", 0)).toBe(true);
    expect(names(c)).toEqual(["C", "A", "B"]);
  });

  it("clamps an index past the end", () => {
    const c = nav();
    expect(reorderGroup(c, "A", 99)).toBe(true);
    expect(names(c)).toEqual(["B", "C", "A"]);
  });

  it("reorders within a tab, not across the whole document", () => {
    const c = {
      navigation: {
        tabs: [
          { tab: "T1", groups: [{ group: "A" }, { group: "B" }] },
          { tab: "T2", groups: [{ group: "X" }, { group: "Y" }] },
        ],
      },
    } as Record<string, unknown>;
    expect(reorderGroup(c, "Y", 0)).toBe(true);
    const tabs = (navRoot(c) as { tabs: { groups: { group: string }[] }[] }).tabs;
    expect(tabs[0].groups.map((g) => g.group)).toEqual(["A", "B"]);
    expect(tabs[1].groups.map((g) => g.group)).toEqual(["Y", "X"]);
  });

  it("reorders a nested subgroup among its own siblings", () => {
    const c = {
      navigation: {
        groups: [{ group: "P", groups: [{ group: "c1" }, { group: "c2" }] }],
      },
    } as Record<string, unknown>;
    expect(reorderGroup(c, "c2", 0)).toBe(true);
    const p = findGroup(navRoot(c), "P")!;
    expect((p.groups as { group: string }[]).map((g) => g.group)).toEqual(["c2", "c1"]);
  });

  it("refuses an unknown group", () => {
    const c = nav();
    expect(reorderGroup(c, "Ghost", 0)).toBe(false);
    expect(names(c)).toEqual(["A", "B", "C"]);
  });
});

describe("navPageSlugs", () => {
  it("collects every page slug across tabs and nesting", () => {
    expect(navPageSlugs(config())).toEqual(["index", "quickstart", "deep/one"]);
  });

  it("ignores anchor/dropdown hrefs — those are links, not pages to re-add", () => {
    const c = {
      navigation: {
        anchors: [{ anchor: "API", href: "https://example.com/api" }],
        groups: [{ group: "G", pages: ["real"] }],
      },
    };
    expect(navPageSlugs(c)).toEqual(["real"]);
  });

  it("de-dupes a slug listed in two places", () => {
    const c = {
      navigation: {
        groups: [
          { group: "A", pages: ["shared"] },
          { group: "B", pages: ["shared", "other"] },
        ],
      },
    };
    expect(navPageSlugs(c)).toEqual(["shared", "other"]);
  });
});

// Regression: "Add existing page" rendered an apparently EMPTY submenu. The index page is `""`
// from listPageSlugs (its route is `/`) but `index` in docs.json — buildNav emits `/index` — so
// comparing raw strings made it look absent from its own nav. It was then offered as a row with
// no label, and on a site where every other page was already listed, that blank row WAS the
// whole submenu.
describe("canonicalSlug", () => {
  it("collapses the index page's two spellings", () => {
    expect(canonicalSlug("")).toBe("index");
    expect(canonicalSlug("/")).toBe("index");
    expect(canonicalSlug("index")).toBe("index");
    expect(canonicalSlug("/index")).toBe("index");
  });

  it("leaves ordinary slugs alone, minus surrounding slashes", () => {
    expect(canonicalSlug("guides/intro")).toBe("guides/intro");
    expect(canonicalSlug("/guides/intro/")).toBe("guides/intro");
  });
});

describe("unlistedPageSlugs", () => {
  it("does not offer the index page when the nav already lists it", () => {
    expect(unlistedPageSlugs(["", "quickstart"], ["/index", "/quickstart"])).toEqual([]);
  });

  it("offers the index page as 'index' when the nav really doesn't list it", () => {
    // Never as "" — a blank row is unclickable-looking and writes an empty nav entry.
    expect(unlistedPageSlugs([""], ["/quickstart"])).toEqual(["index"]);
  });

  it("returns only genuinely unreferenced pages", () => {
    expect(unlistedPageSlugs(["", "a", "b", "c"], ["/index", "/b"])).toEqual(["a", "c"]);
  });

  it("de-dupes page slugs that canonicalise to the same page", () => {
    expect(unlistedPageSlugs(["", "index"], ["/quickstart"])).toEqual(["index"]);
  });

  it("never returns an empty string, whatever it's given", () => {
    for (const s of unlistedPageSlugs(["", "/", "x"], [])) expect(s).not.toBe("");
  });
});

describe("addPageToGroup with the index page", () => {
  it("writes 'index', not the empty slug listPageSlugs reports", () => {
    const c = { navigation: { groups: [{ group: "G", pages: ["other"] }] } };
    expect(addPageToGroup(c, "G", "")).toBe(true);
    expect(findGroup(navRoot(c), "G")!.pages).toEqual(["other", "index"]);
  });

  it("recognises an already-listed index page under either spelling", () => {
    const c = { navigation: { groups: [{ group: "G", pages: ["index"] }] } };
    expect(addPageToGroup(c, "G", "")).toBe(false);
    expect(addPageToGroup(c, "G", "/index")).toBe(false);
  });
});

describe("newPageSlug", () => {
  it("slugifies the title", () => {
    expect(newPageSlug("Getting Started", [])).toBe("getting-started");
    expect(newPageSlug("What's New?", [])).toBe("whats-new");
  });

  it("suffixes numerically on collision — predictable, unlike a random suffix in a URL", () => {
    expect(newPageSlug("Overview", ["overview"])).toBe("overview-2");
    expect(newPageSlug("Overview", ["overview", "overview-2"])).toBe("overview-3");
  });

  it("compares against taken slugs regardless of a leading slash", () => {
    expect(newPageSlug("Overview", ["/overview"])).toBe("overview-2");
  });

  it("falls back to 'untitled' when a title slugifies to nothing", () => {
    expect(newPageSlug("!!!", [])).toBe("untitled");
    expect(newPageSlug("", ["untitled"])).toBe("untitled-2");
  });

  it("honours a folder prefix, and dedupes within it", () => {
    expect(newPageSlug("Intro", [], "guides")).toBe("guides/intro");
    expect(newPageSlug("Intro", ["guides/intro"], "guides/")).toBe("guides/intro-2");
  });
});

describe("newPageContent", () => {
  it("emits parseable frontmatter for a hostile title", () => {
    // An unquoted `title: A: B` is invalid YAML — the brand-new page would fail to parse on
    // its first render, which is the worst possible first impression of "New page".
    const body = newPageContent('Pricing: "tiers" & things');
    expect(body).toContain('title: "Pricing: \\"tiers\\" & things"');
    expect(body.startsWith("---\n")).toBe(true);
    expect(body).toContain("\n---\n");
  });
});
