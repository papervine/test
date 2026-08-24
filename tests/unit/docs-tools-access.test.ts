import { describe, it, expect } from "vitest";
import { parseDocsConfig } from "@papervine/renderer/lib/config";
import { contentContext, parsePage, type ContentSource } from "@papervine/renderer/lib/content";
import { canAccessPage } from "@/lib/reader-auth";
import { withReaderAccess } from "@/lib/reader-access";
import { searchDocs, readPage, listPages } from "@papervine/renderer/lib/docs-tools";
import { renderLlmsTxt } from "@/lib/llms";

// Reader-auth gating (SPEC §11.2) must reach the RETRIEVAL surfaces, not just the renderer:
// the Cmd-K search, the AI assistant's RAG (searchDocs/readPage/listPages), and the MCP
// server all run through docs-tools. Before this, a reader could pull a group-gated page's
// content via any of them even though the renderer would 404 it — the leak this guards.
//
// We drive docs-tools against a stub content source (a public page + an `admin`-gated page)
// under different access predicates, exactly the way a route sets one via withReaderAccess().

function gatedSource(): ContentSource {
  const pages: Record<string, string> = {
    "public-intro":
      "---\ntitle: Public Intro\n---\nThe wombat quickstart is open to everyone.",
    "internal/secrets":
      "---\ntitle: Internal Secrets\ngroups: [admin]\n---\nThe wombat admin runbook with privileged details.",
  };
  const { config } = parseDocsConfig({
    name: "Gated Tenant",
    navigation: {
      groups: [{ group: "Docs", pages: ["public-intro", "internal/secrets"] }],
    },
  });
  return {
    async loadConfig() {
      return config;
    },
    async loadPage(slug) {
      const raw = pages[slug];
      return raw ? parsePage(slug, raw) : null;
    },
    async listPageSlugs() {
      return Object.keys(pages);
    },
  };
}

// Predicates a route would install: a reader in `admin`, and an anonymous reader (no groups,
// the MCP case). canAccessPage encodes the SPEC §11.2 rule.
const asAdmin = (fn: () => Promise<unknown>) =>
  contentContext.run(gatedSource(), () =>
    withReaderAccess((fm) => canAccessPage(fm.groups, fm.public, ["admin"]), fn),
  );
const asAnon = (fn: () => Promise<unknown>) =>
  contentContext.run(gatedSource(), () =>
    withReaderAccess((fm) => canAccessPage(fm.groups, fm.public, []), fn),
  );
const ungated = (fn: () => Promise<unknown>) =>
  contentContext.run(gatedSource(), fn); // no predicate set → ALLOW_ALL (non-gated site)

describe("docs-tools honor reader access (SPEC §11.2)", () => {
  it("searchDocs hides a gated page from a reader without the group", async () => {
    const anon = (await asAnon(() => searchDocs("wombat"))) as { href: string }[];
    expect(anon.some((h) => h.href.startsWith("/internal/secrets"))).toBe(false);
    expect(anon.some((h) => h.href.startsWith("/public-intro"))).toBe(true);
  });

  it("searchDocs returns the gated page to a reader in the group", async () => {
    const admin = (await asAdmin(() => searchDocs("wombat"))) as { href: string }[];
    expect(admin.some((h) => h.href.startsWith("/internal/secrets"))).toBe(true);
  });

  it("readPage denies a gated page (indistinguishable from missing)", async () => {
    const denied = (await asAnon(() => readPage("internal/secrets"))) as { error?: string };
    expect(denied.error).toBeDefined();
    const allowed = (await asAdmin(() => readPage("internal/secrets"))) as { title?: string; error?: string };
    expect(allowed.error).toBeUndefined();
    expect(allowed.title).toBe("Internal Secrets");
  });

  it("readPage always serves a public page", async () => {
    const page = (await asAnon(() => readPage("public-intro"))) as { title?: string };
    expect(page.title).toBe("Public Intro");
  });

  it("listPages omits gated pages for a reader without the group", async () => {
    const anon = (await asAnon(() => listPages())) as { href: string }[];
    expect(anon.map((p) => p.href)).toContain("/public-intro");
    expect(anon.map((p) => p.href)).not.toContain("/internal/secrets");
    const admin = (await asAdmin(() => listPages())) as { href: string }[];
    expect(admin.map((p) => p.href)).toContain("/internal/secrets");
  });

  it("llms-full.txt inlines only accessible pages (corpus dump can't leak gated content)", async () => {
    const anon = (await asAnon(() => renderLlmsTxt("https://x.test", true))) as string;
    expect(anon).toContain("Public Intro");
    expect(anon).not.toContain("Internal Secrets");
    expect(anon).not.toContain("privileged details");
    const admin = (await asAdmin(() => renderLlmsTxt("https://x.test", true))) as string;
    expect(admin).toContain("privileged details");
  });

  it("no predicate set → ALLOW_ALL, so a non-gated site is unchanged", async () => {
    const all = (await ungated(() => listPages())) as { href: string }[];
    expect(all.map((p) => p.href)).toContain("/internal/secrets");
    const hits = (await ungated(() => searchDocs("wombat"))) as { href: string }[];
    expect(hits.some((h) => h.href.startsWith("/internal/secrets"))).toBe(true);
  });
});
