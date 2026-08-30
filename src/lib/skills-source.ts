import "server-only";
import { listRaw, loadRaw } from "@papervine/renderer/lib/content";
import { getObjectText } from "./storage";
import {
  GENERATED_SKILL_PATH,
  parseSkill,
  ROOT_SKILL_PATH,
  SKILL_DIRS,
  SKILL_DIR_FILE,
  type Skill,
} from "./skills";

/**
 * Read every skill file a docs repo publishes, through the active ContentSource — so the same
 * repo resolves identically under a local `papervine dev` preview (disk) and a synced tenant
 * (object storage). Reading the filesystem directly here would only ever work for the former.
 *
 * Two shapes, both supported because a repo can legitimately have either:
 *   skill.md                          one skill at the docs root
 *   .papervine/skills/{name}/SKILL.md  several, one per subdirectory
 *
 * Ordering is deterministic — root first, then directories alphabetically — because the
 * manifests and the agent card are cached and copied around by agents, and a set that reshuffles
 * per request makes their digests look like changes.
 */
export async function loadSkills(): Promise<Skill[]> {
  // Through the package's `source()` accessor, NOT `contentContext.getStore()` directly: a
  // tenant request has a source in context, but the apex and single-repo preview (the CLI, the
  // smoke gate) have none and fall back to the local default. Reading the store directly makes
  // every skill silently vanish on exactly those hosts.
  const out: Skill[] = [];
  const seen = new Set<string>();

  const add = (raw: string | null, fallbackName: string) => {
    if (raw === null) return;
    const skill = parseSkill(raw, fallbackName);
    // First wins on a slug collision, so a duplicate slug in a later
    // directory is ignored.
    if (skill && !seen.has(skill.slug)) {
      seen.add(skill.slug);
      out.push(skill);
    }
  };

  add(await loadRaw(ROOT_SKILL_PATH).catch(() => null), "skill");

  for (const dir of SKILL_DIRS) {
    const keys = await listRaw(dir).catch(() => [] as string[]);
    const names = keys
      .filter((k) => k.endsWith(`/${SKILL_DIR_FILE}`))
      .map((k) => k.slice(dir.length).split("/")[0])
      .filter(Boolean)
      .sort();
    for (const name of names) {
      add(await loadRaw(`${dir}${name}/${SKILL_DIR_FILE}`).catch(() => null), name);
    }
  }

  return out;
}

/**
 * OUTSIDE the synced content tree, and that placement is load-bearing.
 *
 * `skill.md` at the docs root is a file the sync manifest owns: writing there would be a content
 * change, which marks the site stale, which regenerates it, which writes there again. That is
 * the self-trigger loop `fireContentUpdateAutomations` exists to break, and this repo has
 * already paid for it once (a random dedupe key that defeated the breaker and burned toward the
 * daily cap). A dot-prefixed path outside the manifest can't be swept as stale by the sync and
 * can't be picked up as a page (`isPageSlug`), so the loop has nowhere to close.
 */
export function generatedSkillKey(siteId: string): string {
  return `sites/${siteId}/${GENERATED_SKILL_PATH}`;
}

/**
 * Read the generated file for a site, if one exists.
 *
 * Straight from storage rather than through the content source's `loadRaw`, and that is not an
 * optimisation — it's required. `loadRaw` is cached under the site's CONTENT version key
 * (`${sha}:${updatedAt}`), and generation deliberately does not bump `updatedAt` (doing so would
 * invalidate every page of a site whose pages didn't change, and would mark the site's content
 * as moved — the loop). So a regenerated file written under an unchanged version key is
 * invisible to `loadRaw` until something else changes the content: the file on disk is new and
 * every reader keeps getting the old one. Caught by regenerating twice and watching the second
 * one not appear.
 *
 * Uncached is fine here: these endpoints already carry `s-maxage=3600`, so the repeat fetches an
 * agent crawl produces are absorbed at the edge, not by this call.
 */
export async function loadGeneratedSkill(siteId: string): Promise<string | null> {
  return getObjectText(generatedSkillKey(siteId)).catch(() => null);
}

/**
 * Every skill a site publishes: the repo's own files, or — when it has none — the one we
 * generated for it (SPEC §9.1).
 *
 * The fallback is checked last and only when the repo supplied nothing, so an author's own file
 * always wins outright: we never publish a generated rival alongside a hand-written one.
 */
export async function loadSkillsWithGenerated(siteId: string | null): Promise<Skill[]> {
  const authored = await loadSkills();
  if (authored.length > 0 || !siteId) return authored;

  const generated = await loadGeneratedSkill(siteId).catch(() => null);
  if (!generated) return [];
  const skill = parseSkill(generated, "skill");
  return skill ? [skill] : [];
}
