import { cpSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// A plain .mjs helper, shared with scripts/mirror-cli.mjs so the publish gate and this test
// can't disagree about what a valid plugin looks like.
import { checkCursorPlugin } from "../../scripts/lib/check-cursor-plugin.mjs";

/**
 * `agent-context/` is published verbatim to `papervine/cursor-plugin` (SPEC §10.6), where
 * Cursor loads it. Everything that can be wrong with it is structural and silent: a plugin
 * Cursor can't parse looks exactly like a plugin nobody installed, and a skill routing to a
 * reference file that was renamed reads to the agent as "nothing more to know".
 *
 * The mirror runs the same checks before publishing. This runs them on every `npm run
 * test:unit`, so a rename is caught in the commit that makes it rather than at publish time.
 */
const PLUGIN = path.resolve(__dirname, "../../agent-context");

describe("cursor plugin tree", () => {
  it("is structurally loadable", () => {
    expect(checkCursorPlugin(PLUGIN)).toEqual([]);
  });

  it("declares the papervine skill", () => {
    const skill = readFileSync(path.join(PLUGIN, "skills/papervine/SKILL.md"), "utf8");
    expect(skill).toMatch(/^name:\s*papervine$/m);
  });

  it("ships the files Cursor and the marketplace read", () => {
    for (const rel of [".cursor-plugin/plugin.json", "mcp.json", "README.md", "LICENSE"]) {
      expect(existsSync(path.join(PLUGIN, rel)), `${rel} is missing`).toBe(true);
    }
  });

  it("points its MCP servers at endpoints Papervine actually serves", () => {
    const mcp = JSON.parse(readFileSync(path.join(PLUGIN, "mcp.json"), "utf8"));
    // Two endpoints exist and they are not interchangeable: the read MCP is `/mcp` on a docs
    // host, and the authoring (write) MCP is `/authoring/mcp` on the app host, where the
    // session and the OAuth flow live. Anything else is a URL that 404s or bounces to a login
    // page — which an MCP client reports as an unhelpful connection failure.
    for (const server of Object.values(mcp.mcpServers) as { url: string }[]) {
      expect(server.url).toMatch(/^https:\/\/[^/]+\/(authoring\/)?mcp$/);
    }

    // The authoring server must be on the app host specifically. `docs.papervine.io/authoring/mcp`
    // would look right and answer 404: the route only exists on the control plane.
    const authoring = mcp.mcpServers["Papervine Authoring"];
    if (authoring) expect(authoring.url).toBe("https://app.papervine.io/authoring/mcp");
  });

  it("keeps the rules file scoped to docs files", () => {
    const rule = readFileSync(path.join(PLUGIN, "rules/papervine.mdc"), "utf8");
    // Without globs the rule either never fires or fires on every file in the repo; both are
    // worse than not shipping it.
    expect(rule).toMatch(/^globs:\s*\[.*mdx.*\]$/m);
  });

  // A checker that returns [] because it looked at nothing would pass every test above, so
  // prove it actually detects the failure it exists for: the reference file that got renamed
  // without the SKILL.md index following it.
  it("catches a reference file the skill index no longer names", () => {
    const scratch = mkdtempSync(path.join(os.tmpdir(), "pv-plugin-"));
    scratchDirs.push(scratch);
    cpSync(PLUGIN, scratch, { recursive: true });

    const refDir = path.join(scratch, "skills/papervine/reference");
    renameSync(path.join(refDir, "cli.md"), path.join(refDir, "cli-reference.md"));

    const problems = checkCursorPlugin(scratch);
    expect(problems).toContain(
      "skills/papervine/SKILL.md routes to skills/papervine/reference/cli.md, which does not exist",
    );
    expect(problems).toContain(
      "skills/papervine/reference/cli-reference.md exists but skills/papervine/SKILL.md never routes to it",
    );
  });
});

const scratchDirs: string[] = [];
afterAll(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});
