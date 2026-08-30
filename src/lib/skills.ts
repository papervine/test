import { createHash } from "node:crypto";
import matter from "gray-matter";

/**
 * `skill.md` — the agent-facing capability summary a docs site publishes, alongside `llms.txt`.
 *
 * The two are complementary and it's worth keeping the distinction straight: `llms.txt` is a
 * DIRECTORY (here are my pages, go read one), while a skill is a CAPABILITY SUMMARY (here is
 * what you can accomplish with this product, what inputs it needs, what constraints apply). An
 * agent uses the first to find information and the second to decide it can act at all.
 *
 * Format-compatible on purpose (CLAUDE.md: match the format, don't guess), so a docs repo that
 * already ships skill files serves them here unchanged.
 *
 * Pure: no `server-only`, no I/O. Reading files is `skills-source.ts`; this decides what a skill
 * IS and what the discovery documents look like.
 */

export type Skill = {
  /** URL-safe slug derived from `name` — what the discovery endpoints address it by. */
  slug: string;
  name: string;
  description: string;
  /** The file verbatim, frontmatter included: what `/skill.md` and the per-skill URLs serve. */
  raw: string;
  /** Reader groups allowed to see it, from `groups:`. Empty = public. */
  groups: string[];
};

/** Where a skill file can live in a docs repo, in resolution order. */
export const ROOT_SKILL_PATH = "skill.md";
/** Where a skills directory lives in a docs repo. */
export const SKILL_DIRS = [".papervine/skills/"];
/** Inside a skills directory each skill is its own subdirectory holding this file. */
export const SKILL_DIR_FILE = "SKILL.md";

/** The description field is capped in the discovery manifests. */
const DESCRIPTION_MAX = 1024;

/**
 * A URL-safe slug for a skill's `name`. Deliberately the same shape as our page slugs: lowercase,
 * non-alphanumerics collapsed to single hyphens, trimmed.
 */
export function slugifySkillName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Parse one skill file. `fallbackName` is used when the frontmatter has no `name` — a file with
 * unreadable or missing frontmatter is still served rather than dropped, because a skill that
 * silently disappears from the index is worse than one with a plain name. Same posture as the
 * renderer's own frontmatter handling (GAP-REPORT §S1).
 */
export function parseSkill(raw: string, fallbackName: string): Skill | null {
  if (raw.trim() === "") return null;

  let data: Record<string, unknown> = {};
  try {
    data = matter(raw).data ?? {};
  } catch {
    // Malformed YAML — keep the file, lose the metadata.
  }

  const name = typeof data.name === "string" && data.name.trim() !== "" ? data.name.trim() : fallbackName;
  const slug = slugifySkillName(name) || slugifySkillName(fallbackName) || "skill";
  const description =
    typeof data.description === "string" ? data.description.trim().slice(0, DESCRIPTION_MAX) : "";

  // `groups` mirrors page frontmatter (SPEC §11.2): a list of reader groups. Anything that
  // isn't a list of strings is treated as "restricted to nothing nameable", i.e. not public —
  // failing closed, because the alternative leaks a gated capability summary.
  const groups = Array.isArray(data.groups)
    ? data.groups.filter((g): g is string => typeof g === "string")
    : data.groups === undefined
      ? []
      : ["__unparseable__"];

  return { slug, name, description, raw, groups };
}

/**
 * The skills an unauthenticated agent may see.
 *
 * These endpoints carry no reader session (the same position as `llms.txt` and the widget), so
 * a skill with `groups:` is withheld entirely rather than served with its body trimmed — a
 * capability summary is a single document, and there is no partial version of it that is safe.
 */
export function publicSkills(skills: Skill[]): Skill[] {
  return skills.filter((s) => s.groups.length === 0);
}

/** `sha256:…` over the file bytes, for the agent-skills manifest's integrity field. */
export function skillDigest(raw: string): string {
  return `sha256:${createHash("sha256").update(raw, "utf8").digest("hex")}`;
}

/**
 * `/.well-known/agent-skills/index.json` — the agent-skills 0.2.0 discovery document, which
 * adds a content digest so an agent can verify what it fetched.
 */
export function agentSkillsIndex(skills: Skill[]) {
  return {
    $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
    skills: skills.map((s) => ({
      name: s.slug,
      type: "skill-md" as const,
      description: s.description,
      url: `/.well-known/agent-skills/${s.slug}/SKILL.md`,
      digest: skillDigest(s.raw),
    })),
  };
}

/** `/.well-known/skills/index.json` — the older, simpler discovery format. */
export function skillsIndex(skills: Skill[]) {
  return {
    skills: skills.map((s) => ({
      name: s.slug,
      description: s.description,
      files: [SKILL_DIR_FILE],
    })),
  };
}

/**
 * `/.well-known/agent-card.json` — an A2A 0.3 agent card, so an A2A client can discover the
 * site and everything it exposes in ONE request instead of walking the discovery endpoints.
 *
 * Every URL is absolute against the site's canonical origin: the card is copied around by
 * agents, so a relative path in it resolves against whoever is holding it.
 */
export function agentCard(input: {
  origin: string;
  title: string;
  description: string;
  skills: Skill[];
}) {
  const base = input.origin.replace(/\/+$/, "");
  return {
    protocolVersion: "0.3",
    name: input.title,
    description: input.description,
    url: base,
    documentationUrl: base,
    preferredTransport: "HTTP+JSON",
    supportedInterfaces: [
      { url: base, protocolBinding: "HTTP+JSON", protocolVersion: "0.3" },
    ],
    provider: { url: base, organization: input.title },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    capabilities: { streaming: false, pushNotifications: false },
    skills: input.skills.map((s) => ({
      id: s.slug,
      name: s.name,
      description: s.description,
      url: `${base}/.well-known/agent-skills/${s.slug}/SKILL.md`,
      tags: ["documentation"],
    })),
  };
}
