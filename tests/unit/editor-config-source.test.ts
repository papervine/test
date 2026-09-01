import { describe, it, expect } from "vitest";
import { parseDocsConfig } from "@papervine/renderer/lib/config";
import { contentContext, parsePage, type ContentSource } from "@papervine/renderer/lib/content";
import { buildNav, type NavLeaf, type NavNode } from "@papervine/renderer/lib/nav";

// Regression for the editor sidebar showing the WRONG site's pages (Papervine's own docs
// instead of the edited tenant's). Root cause: `loadConfig` is a per-request React `cache()`
// keyed only on its (empty) args — see packages/renderer/lib/content.ts. The root layout
// renders first on the app host, finds no tenant source, and primes that memo with the
// DEFAULT content/ config. The editor page later runs inside `contentContext.run(draftSrc)`,
// but the memo can't re-resolve the now-active source, so `loadConfig()` returns the cached
// DEFAULT and buildNav produces our docs' nav, not the site's. The first fix: the editor reads
// config straight from its resolved `src`, bypassing the poisoned memo. (The memo is now keyed
// by source id too — see the second describe block, which is where the general fix lives.)
//
// React's `cache()` only memoizes inside a render request (under Node it's an identity pass-
// through), so we model the per-request memo explicitly — an arg-keyed memo over the SAME
// `contentContext.getStore() ?? default` resolution content.ts uses — to reproduce the exact
// poisoning shape against the real buildNav.

function topGroups(nodes: (NavLeaf | NavNode)[]): string[] {
  return nodes.filter((n): n is NavNode => "group" in n).map((n) => n.group);
}

function sourceFor(name: string, groups: string[]): ContentSource {
  const { config } = parseDocsConfig({
    name,
    navigation: { groups: groups.map((g) => ({ group: g, pages: [`${g.toLowerCase()}/index`] })) },
  });
  return {
    loadConfig: async () => config,
    loadPage: async (slug) => parsePage(slug, `---\ntitle: ${slug}\n---\nbody`),
    listPageSlugs: async () => groups.map((g) => `${g.toLowerCase()}/index`),
  };
}

// The default content/ repo (Papervine's own docs) and a connected tenant's draft source,
// with deliberately disjoint nav groups so a poisoned read is unmistakable.
const defaultSrc = sourceFor("Papervine Docs", ["Platform", "Renderer"]);
const draftSrc = sourceFor("Starter Docs", ["Get Started", "Guides", "Widgets"]);

// The exported `loadConfig` memo: arg-keyed (here, no args → one slot), resolving the active
// source the moment it's first called — exactly content.ts's `cache(() => source().loadConfig())`.
function makeRequestMemo() {
  let cached: ReturnType<ContentSource["loadConfig"]> | undefined;
  return () => (cached ??= (contentContext.getStore() ?? defaultSrc).loadConfig());
}

describe("editor reads nav config from its own source, not the poisoned request memo", () => {
  it("would show the wrong site's nav if it used the shared memo (documents the bug)", async () => {
    const loadConfig = makeRequestMemo();

    // Phase 1 — root layout: no tenant source on the app host, so it primes the memo with default.
    await loadConfig();

    // Phase 2 — editor page, inside the draft source's context but reading via the shared memo.
    const buggyGroups = await contentContext.run(draftSrc, async () => {
      const config = await loadConfig(); // poisoned: returns the DEFAULT config
      return topGroups((await buildNav(config)).flatMap((s) => s.nodes));
    });

    expect(buggyGroups).toEqual(["Platform", "Renderer"]); // Papervine's docs — the reported bug
  });

  it("shows the edited site's nav when it reads config from `src` directly (the fix)", async () => {
    const loadConfig = makeRequestMemo();

    // Phase 1 — root layout primes the memo with default, same as above.
    await loadConfig();

    // Phase 2 — editor page reads config from its resolved draft `src`, bypassing the memo.
    const fixedGroups = await contentContext.run(draftSrc, async () => {
      const config = await draftSrc.loadConfig();
      return topGroups((await buildNav(config)).flatMap((s) => s.nodes));
    });

    expect(fixedGroups).toEqual(["Get Started", "Guides", "Widgets"]); // the edited site's own nav
  });
});

// The workaround above fixes the surface that knows to apply it. The FULL-SITE draft preview
// didn't: it renders through TenantDocsShell, which calls the shared `loadConfig()`, so the
// preview showed the draft's pages inside Papervine's own nav, colours and banner — and every
// edit in the Site settings drawer looked like it had done nothing. So the memo key itself now
// carries the active source's id (content.ts), and the poisoning is structurally impossible.

/** The memo as it is now: keyed by the active source's id, not by "no arguments". */
function makeKeyedRequestMemo(fallback: ContentSource) {
  const slots = new Map<string, ReturnType<ContentSource["loadConfig"]>>();
  return () => {
    const src = contentContext.getStore() ?? fallback;
    const key = src.id ?? "default";
    const hit = slots.get(key);
    if (hit) return hit;
    const fresh = src.loadConfig();
    slots.set(key, fresh);
    return fresh;
  };
}

describe("the per-request config memo is keyed by source", () => {
  it("gives two sources in one request their own entries", async () => {
    const platform = { ...sourceFor("Papervine Docs", ["Platform", "Renderer"]), id: "fs:/content" };
    const draft = { ...sourceFor("Starter Docs", ["Get Started", "Guides"]), id: "draft:site-1:main:" };
    const loadConfig = makeKeyedRequestMemo(platform);

    // Phase 1 — the root layout primes the memo on the app host, where there's no tenant source.
    expect((await loadConfig()).name).toBe("Papervine Docs");

    // Phase 2 — the preview renders inside the draft source. It must see the DRAFT's config.
    const inPreview = await contentContext.run(draft, () => loadConfig());
    expect(inPreview.name).toBe("Starter Docs");

    // …and the platform entry is still intact, so priming isn't destroyed either way.
    expect((await loadConfig()).name).toBe("Papervine Docs");
  });

  it("every real source declares a distinct id", async () => {
    // A source that forgets `id` falls back to the shared "default" slot — which is exactly the
    // bug above. These are the four the app actually renders through.
    const { fsSource } = await import("@papervine/renderer/lib/content");
    const { s3Source } = await import("@/lib/s3-source");
    const { draftSource } = await import("@/lib/draft-source");

    const ids = [
      fsSource("content").id,
      fsSource("docs").id,
      s3Source("site-1", "sha:1").id,
      s3Source("site-1", "sha:2").id,
      s3Source("site-2", "sha:1").id,
      draftSource("site-1", "main", "sha:1").id,
      draftSource("site-1", "release", "sha:1").id,
    ];
    expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
