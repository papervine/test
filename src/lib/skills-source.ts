import "server-only";
import { listRaw, loadRaw } from "@papervine/renderer/lib/content";
import {
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
