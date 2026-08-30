import { describe, it, expect } from "vitest";
import {
  buildSkillPrompt,
  capabilityFingerprint,
  finalizeSkill,
  isGeneratedSkill,
  shouldGenerate,
} from "@/lib/skill-generation";

describe("capabilityFingerprint", () => {
  const base = { config: '{"name":"Acme"}', slugs: ["index", "guides/auth"] };

  it("is stable across slug ORDER — a listing that reshuffles isn't a change", () => {
    expect(capabilityFingerprint(base)).toBe(
      capabilityFingerprint({ ...base, slugs: ["guides/auth", "index"] }),
    );
  });

  it("moves when a page is added or removed", () => {
    expect(capabilityFingerprint({ ...base, slugs: [...base.slugs, "guides/new"] })).not.toBe(
      capabilityFingerprint(base),
    );
  });

  it("moves when docs.json changes — that's where the nav and the tabs live", () => {
    expect(capabilityFingerprint({ ...base, config: '{"name":"Acme Docs"}' })).not.toBe(
      capabilityFingerprint(base),
    );
  });
});

describe("shouldGenerate", () => {
  const now = { hasAuthoredSkill: false, storedFingerprint: "a", currentFingerprint: "a", stale: false };

  it("never competes with a skill the author wrote", () => {
    expect(shouldGenerate({ ...now, hasAuthoredSkill: true, storedFingerprint: null })).toBe(false);
    expect(shouldGenerate({ ...now, hasAuthoredSkill: true, force: true })).toBe(false);
  });

  it("generates immediately the first time — there is nothing to debounce", () => {
    expect(shouldGenerate({ ...now, storedFingerprint: null })).toBe(true);
  });

  it("skips a publish that didn't move the surface — the typo-run case", () => {
    expect(shouldGenerate({ ...now, stale: true, currentFingerprint: "a" })).toBe(false);
  });

  it("generates when a publish DID move the surface", () => {
    expect(shouldGenerate({ ...now, stale: true, currentFingerprint: "b" })).toBe(true);
  });

  it("ignores a moved fingerprint with no publish behind it", () => {
    // Nothing is live yet, so there is nothing for an agent to read differently.
    expect(shouldGenerate({ ...now, stale: false, currentFingerprint: "b" })).toBe(false);
  });

  it("force overrides the fingerprint, but not an authored file", () => {
    expect(shouldGenerate({ ...now, force: true })).toBe(true);
  });
});

describe("finalizeSkill", () => {
  const out = finalizeSkill({
    body: "# Acme Skill\n\n## Product summary\n\nIt does things.",
    siteName: "Acme",
    siteSlug: "acme",
    docsUrl: "https://docs.acme.com/",
    description: "Use when   doing\nthings.",
  });

  it("stamps OUR frontmatter, so name and slug never depend on the model", () => {
    expect(out.startsWith("---\nname: Acme\n")).toBe(true);
    expect(out).toContain("site: acme");
  });

  it("marks the file as generated, so a reader can tell it from an authored one", () => {
    expect(isGeneratedSkill(out)).toBe(true);
    expect(isGeneratedSkill("---\nname: Hand written\n---\n\nBody")).toBe(false);
  });

  it("normalizes whitespace in the description — it has to survive one YAML line", () => {
    expect(out).toContain('description: "Use when doing things."');
  });

  it("appends Resources with URLs we construct, not ones the model guessed", () => {
    expect(out).toContain("- **Comprehensive page listing:** https://docs.acme.com/llms.txt");
    // The trailing slash on the input origin must not double up.
    expect(out).not.toContain("//llms.txt");
  });

  it("strips a whole-document code fence the model wrapped around its answer", () => {
    const fenced = finalizeSkill({
      body: "```markdown\n# X Skill\n\nBody.\n```",
      siteName: "X",
      siteSlug: "x",
      docsUrl: "https://x.dev",
      description: "d",
    });
    expect(fenced).toContain("# X Skill");
    expect(fenced).not.toContain("```markdown");
  });

  it("drops frontmatter the model emitted anyway, rather than shipping two blocks", () => {
    const doubled = finalizeSkill({
      body: "---\nname: Wrong Name\n---\n\n# Y Skill\n\nBody.",
      siteName: "Y",
      siteSlug: "y",
      docsUrl: "https://y.dev",
      description: "d",
    });
    expect(doubled).not.toContain("Wrong Name");
    expect(doubled.match(/^---$/gm)?.length).toBe(3); // ours opens + closes, plus the footer rule
  });
});

describe("buildSkillPrompt", () => {
  const prompt = buildSkillPrompt({
    siteName: "Acme",
    siteDescription: "Payments.",
    docsUrl: "https://docs.acme.com",
    navigation: "Guides > Auth",
    pages: [{ slug: "guides/auth", title: "Auth", description: "Sign readers in." }],
  });

  it("gives the model the pages it must ground itself in", () => {
    expect(prompt).toContain("/guides/auth — Auth: Sign readers in.");
    expect(prompt).toContain("Guides > Auth");
  });

  it("tells it NOT to write the parts we stamp ourselves", () => {
    expect(prompt).toContain("No YAML frontmatter");
    expect(prompt).toContain('"Resources" section');
  });

  it("asks for the description as a TRIGGER line, not a blurb about the product", () => {
    // This is the sentence an agent matches on to decide the skill applies at all.
    expect(prompt).toContain("Use when <core activity> — <trigger>");
    expect(prompt).toContain("not a description of the product");
  });

  it("permits omitting Decision guidance rather than inventing a dilemma", () => {
    expect(prompt).toContain("Omit this section entirely");
  });
});
