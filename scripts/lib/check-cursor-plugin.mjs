import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Structural checks for the Cursor plugin tree (`agent-context/` here, the repo root once
 * published to `papervine/cursor-plugin`).
 *
 * A plugin repo has nothing to install, build, or typecheck, so the only things that can be
 * wrong are structural — and every one of them is invisible until Cursor tries to load the
 * plugin and quietly gives up. So this checks exactly what Cursor reads:
 *
 *   - the manifest exists at `.cursor-plugin/plugin.json` and is valid JSON with a `name`
 *   - `mcp.json` parses and every server has a `url`
 *   - every skill directory holds a `SKILL.md` with `name` + `description` frontmatter
 *   - every rules file has frontmatter (Cursor won't scope a rule without it)
 *   - every `reference/*.md` the SKILL.md index names actually exists, and vice versa
 *
 * That last pair is the one that rots on its own: the skill routes to reference files by
 * name, so renaming one leaves the agent following a link to nothing — silently, since a
 * missing file reads as "nothing more to know" rather than as an error.
 *
 * Pure: takes a directory, returns problems. Called by `scripts/mirror-cli.mjs` before it
 * publishes, and by `tests/unit/cursor-plugin.test.ts` against the source tree on every run.
 *
 * @param {string} dir The plugin tree's root.
 * @returns {string[]} One human-readable line per problem; empty means it's fine.
 */
export function checkCursorPlugin(dir) {
  const problems = [];
  const read = (rel) => readFileSync(path.join(dir, rel), "utf8");
  const dirs = (rel) => {
    const abs = path.join(dir, rel);
    if (!existsSync(abs)) return [];
    return readdirSync(abs).filter((e) => statSync(path.join(abs, e)).isDirectory());
  };

  // --- The manifest -------------------------------------------------------
  const manifestPath = ".cursor-plugin/plugin.json";
  if (!existsSync(path.join(dir, manifestPath))) {
    problems.push(`${manifestPath} is missing — Cursor has no plugin to load`);
  } else {
    try {
      const manifest = JSON.parse(read(manifestPath));
      if (!manifest.name) problems.push(`${manifestPath} has no "name"`);
    } catch (err) {
      problems.push(`${manifestPath} does not parse: ${err.message}`);
    }
  }

  // --- MCP servers -------------------------------------------------------
  if (existsSync(path.join(dir, "mcp.json"))) {
    try {
      const mcp = JSON.parse(read("mcp.json"));
      const servers = mcp.mcpServers ?? {};
      if (!Object.keys(servers).length) problems.push("mcp.json declares no servers");
      for (const [name, server] of Object.entries(servers)) {
        // A stdio server has `command` instead; this plugin ships HTTP servers only, and a
        // typo'd key would otherwise publish a server that silently never connects.
        if (!server?.url && !server?.command) {
          problems.push(`mcp.json server "${name}" has neither a url nor a command`);
        }
      }
    } catch (err) {
      problems.push(`mcp.json does not parse: ${err.message}`);
    }
  }

  // --- Rules -------------------------------------------------------------
  const rulesDir = path.join(dir, "rules");
  const rules = existsSync(rulesDir) ? readdirSync(rulesDir).filter((f) => f.endsWith(".mdc")) : [];
  if (!rules.length) problems.push("rules/ contains no .mdc file");
  for (const file of rules) {
    if (!read(path.join("rules", file)).startsWith("---\n")) {
      problems.push(`rules/${file} has no frontmatter — Cursor can't scope it`);
    }
  }

  // --- Skills ------------------------------------------------------------
  const skills = dirs("skills");
  if (!skills.length) problems.push("skills/ contains no skill directory");

  for (const skill of skills) {
    const skillFile = path.join("skills", skill, "SKILL.md");
    if (!existsSync(path.join(dir, skillFile))) {
      problems.push(`${skillFile} is missing`);
      continue;
    }
    const src = read(skillFile);
    for (const field of ["name", "description"]) {
      // Frontmatter only: a `name:` in the prose below doesn't make the skill loadable.
      const frontmatter = src.startsWith("---\n") ? src.slice(4, src.indexOf("\n---", 4)) : "";
      if (!new RegExp(`^${field}:\\s*\\S`, "m").test(frontmatter)) {
        problems.push(`${skillFile} frontmatter has no "${field}"`);
      }
    }

    // The index and the directory must agree, in both directions.
    const refDir = path.join("skills", skill, "reference");
    const onDisk = existsSync(path.join(dir, refDir))
      ? readdirSync(path.join(dir, refDir)).filter((f) => f.endsWith(".md"))
      : [];
    const referenced = new Set(
      [...src.matchAll(/`reference\/([\w.-]+\.md)`/g)].map((m) => m[1]),
    );

    for (const name of referenced) {
      if (!onDisk.includes(name)) {
        problems.push(`${skillFile} routes to ${refDir}/${name}, which does not exist`);
      }
    }
    for (const name of onDisk) {
      if (!referenced.has(name)) {
        problems.push(`${refDir}/${name} exists but ${skillFile} never routes to it`);
      }
    }
  }

  return problems;
}
