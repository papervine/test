import { createHash } from "node:crypto";

/**
 * Generating a site's `skill.md` from its documentation — the pure half: what counts as a
 * change worth regenerating for, what we ask the model, and what we do to its answer.
 *
 * No `server-only` and no I/O, so the parts most likely to go subtly wrong (the staleness rule
 * and the frontmatter we stamp) are unit-testable without a model or a database.
 */

/** Marks a file as ours rather than the author's, and records what produced it. */
export const GENERATED_MARKER = "papervine-generated";

/**
 * A fingerprint of the site's CAPABILITY SURFACE, used to skip regeneration when nothing that
 * matters has changed.
 *
 * Deliberately `docs.json` + the sorted page list, and deliberately NOT the page prose. Two
 * reasons, one principled and one practical. Principled: fixing a typo inside a paragraph does
 * not change what the product can do, and regenerating for it would be the "every publish"
 * behaviour we rejected. Practical: both inputs are already cached per site version (the config
 * read and the key listing), so computing this costs nothing, whereas hashing the corpus would
 * mean reading every page to decide whether to read every page.
 *
 * The accepted blind spot: a page retitled or rewritten without moving changes the docs but not
 * this hash, so its capability summary can lag until the next structural change or a manual
 * regenerate. That's the right side to err on — a stale summary is cheap, a regeneration loop
 * is not.
 */
export function capabilityFingerprint(input: {
  config: string;
  slugs: string[];
}): string {
  const surface = JSON.stringify({
    config: input.config,
    slugs: [...input.slugs].sort(),
  });
  return createHash("sha256").update(surface, "utf8").digest("hex").slice(0, 32);
}

/** Should we spend a model call on this site right now? */
export function shouldGenerate(input: {
  /** An author-supplied skill file always wins — we never overwrite or compete with it. */
  hasAuthoredSkill: boolean;
  /** The fingerprint stored alongside the last generation, or null if never generated. */
  storedFingerprint: string | null;
  /** The fingerprint of the site as it is now. */
  currentFingerprint: string;
  /** The site has published since the last generation. */
  stale: boolean;
  /** An operator or author pressed Regenerate. */
  force?: boolean;
}): boolean {
  if (input.hasAuthoredSkill) return false;
  if (input.force) return true;
  // Never generated: do it now rather than waiting for the next sweep. A brand-new site with no
  // skill at all is exactly where a delay is most visible, and there is nothing to debounce.
  if (input.storedFingerprint === null) return true;
  // Published since we last looked AND the surface actually moved. The flag alone would
  // regenerate for a typo run; the fingerprint alone would mean fingerprinting every tenant on
  // every sweep. Together they narrow cheaply, then decide honestly.
  return input.stale && input.storedFingerprint !== input.currentFingerprint;
}

/** One page, as the prompt sees it. */
export type SkillPage = { slug: string; title: string; description: string };

/**
 * The instruction. The shape it asks for is the agreed template; what's worth noting is what it
 * does NOT ask for — `name`, the metadata, and the Resources block are all things we already
 * know exactly, so they're stamped on afterwards rather than left to the model to reproduce.
 * That removes the likeliest place for it to invent a URL, and shortens the prompt.
 */
export function buildSkillPrompt(input: {
  siteName: string;
  siteDescription: string;
  docsUrl: string;
  pages: SkillPage[];
  navigation: string;
}): string {
  const pages = input.pages
    .map((p) => `- /${p.slug}${p.title ? ` — ${p.title}` : ""}${p.description ? `: ${p.description}` : ""}`)
    .join("\n");

  return `You are writing a \`skill.md\` for a product, from its documentation.

A \`skill.md\` is not a summary of the docs. It tells an AI agent what it can DO with this
product: which jobs it can accomplish, what it needs to know before starting, and what will
surprise it. An agent reads this to decide whether it can act at all, before it goes looking
for the page that explains how.

PRODUCT
Name: ${input.siteName}
Description: ${input.siteDescription || "(none given)"}
Documentation: ${input.docsUrl}

NAVIGATION
${input.navigation}

PAGES
${pages}

Return two fields.

\`description\` — ONE line, in exactly this form:
    Use when <core activity> — <trigger>, <trigger>, <trigger>, <trigger>.
This is how an agent decides whether this skill is relevant at all, so the triggers must be the
concrete situations someone is in when they need this product, not a description of the product.
Under 200 characters.

\`body\` — the Markdown of the file, starting at "# ${input.siteName} Skill", with exactly these
sections, in this order:

## Product summary
2-4 sentences: what the product is, its core object hierarchy (**A → B → C**), the main entry
points in **bold** or \`code\`, and the canonical URL.

## When to use
6-10 bullets, each "**<Task category>** — the situation that calls for it." Each one a distinct
job a user might arrive with.

## Quick reference
Tables. Terminology (Term | Meaning), roles or commands if the product has them (Role | Can do),
and a "Common workflows" list of numbered steps.

## Decision guidance
One table per real fork in the road ("When to use X vs. Y"). Rows are decision FACTORS, not
feature lists. Omit this section entirely if the documentation describes no genuine choice —
an invented dilemma is worse than a missing section.

## Workflow
A typical end-to-end workflow of 8-10 numbered steps, first to last, each naming the exact UI
element, command, or file. Then a secondary or admin workflow if one exists.

## Common gotchas
6-12 bullets: "**<the surprising fact, stated as a rule>** — why it works that way and what to
do instead." This section is the most valuable one in the file. Every bullet must come from
something the documentation actually says. Do not pad it with generic advice.

## Verification checklist
\`- [ ]\` items: what to confirm before closing a task, each with the condition that makes it
true.

RULES
- Ground every claim in the pages listed above. If the documentation doesn't say it, leave it
  out — an agent acting on a capability this product doesn't have fails inside someone's
  product.
- Prefer the product's own vocabulary over generic terms.
- No YAML frontmatter and no "Resources" section in \`body\`: both are added afterwards.
- No preamble and no code fence around \`body\`.`;
}

/** Strip a fence or frontmatter block the model added despite being told not to. */
function cleanBody(raw: string): string {
  let body = raw.trim();
  // A whole-document code fence.
  const fence = body.match(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/);
  if (fence) body = fence[1].trim();
  // Frontmatter it emitted anyway — ours replaces it, so a second block would be a duplicate.
  body = body.replace(/^---\n[\s\S]*?\n---\n+/, "");
  return body.trim();
}

/**
 * Assemble the file we actually publish: our frontmatter, the model's body, our Resources
 * footer.
 *
 * The frontmatter is ours on purpose. `name` and the slug are facts we hold, the marker records
 * that this is generated rather than authored (so a later read can tell the difference without
 * guessing), and the URLs in Resources are ones we can construct exactly — none of which should
 * depend on a model reproducing them correctly.
 */
export function finalizeSkill(input: {
  body: string;
  siteName: string;
  siteSlug: string;
  docsUrl: string;
  description: string;
}): string {
  const base = input.docsUrl.replace(/\/+$/, "");
  const llms = `${base}/llms.txt`;
  const description = input.description.replace(/\s+/g, " ").trim().slice(0, 1024);

  const frontmatter = [
    "---",
    `name: ${input.siteName}`,
    `description: ${JSON.stringify(description)}`,
    "metadata:",
    `    ${GENERATED_MARKER}: "true"`,
    `    site: ${input.siteSlug}`,
    `    version: "1.0"`,
    "---",
  ].join("\n");

  const resources = [
    "## Resources",
    "",
    `- **Comprehensive page listing:** ${llms}`,
    `- **Full documentation:** ${base}`,
    "",
    "---",
    "",
    `> For additional documentation and navigation, see: ${llms}`,
  ].join("\n");

  return `${frontmatter}\n\n${cleanBody(input.body)}\n\n${resources}\n`;
}

/** Was this file written by us? Used to tell a generated file from an authored one. */
export function isGeneratedSkill(raw: string): boolean {
  return raw.includes(`${GENERATED_MARKER}: "true"`);
}
