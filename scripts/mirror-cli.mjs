#!/usr/bin/env node
/**
 * Publish the public-facing parts of this monorepo to their own GitHub repos.
 *
 * Two targets (`--target`), one mechanism:
 *   - `cli`     → `papervine/papervine`, the source-available (ELv2) CLI + render engine
 *   - `starter` → `papervine/starter`, the forkable example docs site
 *
 * The monorepo is the single source of truth. This is a **one-directional** publish:
 * monorepo → public repo, never the reverse. That is deliberate — the renderer is shared
 * with the hosted control plane, so it has to stay here for renderer + control-plane
 * changes to land atomically, and the starter is what `db:seed` builds its test beds from,
 * so it has to be versioned with the tests that depend on it. A submodule would invert the
 * dependency; `git subtree split` doesn't fit either, because the CLI's build needs
 * `packages/renderer`, which lives outside `apps/cli`. See SPEC §10.6.
 *
 * Because it's one-directional, **PRs on a public repo must never be merged there** — a
 * merge would be silently reverted by the next run. Instead they get ported upstream (with
 * the contributor's authorship preserved) and flow back out. The divergence guard below
 * turns a merge-that-would-be-reverted into a loud failure instead of quiet data loss,
 * which is the whole reason it exists.
 *
 * Usage:
 *   node scripts/mirror-cli.mjs --dry-run                     # build + validate, touch nothing
 *   node scripts/mirror-cli.mjs --target starter --dry-run
 *   node scripts/mirror-cli.mjs --initial                     # first import (one commit)
 *   node scripts/mirror-cli.mjs --push                        # replay new commits, then push
 *
 * Flags:
 *   --target <cli|starter>  Which repo to publish (default: cli).
 *   --dry-run      Build the snapshot and validate it; never clone/commit/push.
 *   --initial      Seed a repo with a single squashed "Initial import" commit.
 *   --push         Actually push (otherwise it commits locally and tells you the command).
 *   --from <sha>   Publish this commit instead of HEAD (also skips the clean-tree check).
 *   --repo <url>   Override the target remote.
 *   --keep         Leave the work directory in place for inspection.
 *   --no-validate  Skip the staged-snapshot checks (faster, less safe).
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATES = path.join(REPO, "scripts", "mirror-cli");

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : d);

const DRY_RUN = has("--dry-run");
const INITIAL = has("--initial");
const DO_PUSH = has("--push");
const KEEP = has("--keep");
const VALIDATE = !has("--no-validate");

/**
 * Two publish targets, same machinery.
 *
 *  - **cli** → `papervine/papervine`: the public, source-available half of the monorepo (the CLI and the
 *    render engine it's built from), plus a generated workspace root, tests and CI.
 *  - **starter** → `papervine/starter`: the forkable example docs site. It lives here rather
 *    than being maintained over there because the monorepo *depends* on it — `db:seed` builds
 *    its dev sites from it, including `starter-gated`, the reader-auth test bed whose
 *    `internal/*` pages carry the `groups:` frontmatter that exercises SPEC §11.2. A test
 *    fixture defined in a repo we don't version is a fixture that can change under the tests
 *    that rely on it.
 */
const TARGET = val("--target", "cli");
const TARGETS = {
  cli: { remote: "git@github.com:papervine/papervine.git", label: "the CLI + render engine" },
  starter: { remote: "git@github.com:papervine/starter.git", label: "the example docs site" },
};
if (!TARGETS[TARGET]) {
  console.error(`mirror: unknown --target "${TARGET}". Use one of: ${Object.keys(TARGETS).join(", ")}`);
  process.exit(1);
}
const REMOTE = val("--repo", TARGETS[TARGET].remote);

// Records which monorepo commit the public repo currently reflects. Committed into the
// snapshot so the state lives with the artifact rather than in someone's shell history.
const STAMP = ".mirror-source";

// Every commit this script writes carries this trailer, which is how the divergence guard
// recognises its own work. The legacy form is the wording used before the trailer existed;
// accepted so an already-published repo doesn't read as diverged on the next run.
const MIRROR_TRAILER = "Mirrored-From:";
const LEGACY_TRAILERS = ["Mirrored from ", "Published from the Papervine monorepo at "];

// The two workspaces that are public (Elastic License 2.0). `packages/renderer` is most of the substance
// — apps/cli is thin glue — so open-sourcing "the CLI" necessarily means this too.
const MIRRORED_PATHS = ["apps/cli", "packages/renderer"];

// The renderer's test fixtures: a small docs repo of deliberate edge cases (object favicon,
// `.md` pages, unknown components, bad frontmatter, snippet imports, hidden pages). Several
// of the portable unit tests read it directly, and it's part of the renderer's test suite
// rather than product code, so it travels with them. 68K.
const MIRRORED_TEST_DATA = ["tests/fixtures"];

// The forkable example docs site. One directory, four jobs: the source published to
// `papervine/starter`, the CLI mirror's `examples/starter`, the site `db:seed` seeds from, and
// a crawl target in CI. It used to be duplicated — a gallery in the starter repo and a
// hello-world in the CLI templates — which is exactly the drift this collapses.
const STARTER = "examples/starter";

// Everything whose change can alter the published snapshot, used to select which commits to
// replay. Wider than the mirrored paths on purpose: the templates and this script *generate*
// part of the output, so a fix to either has to be publishable. Without them a generator fix
// reports "nothing to publish" while the public repo stays broken — which is exactly what
// happened to the lockfile fix.
const SOURCE_PATHS = {
  cli: [
    ...MIRRORED_PATHS,
    ...MIRRORED_TEST_DATA,
    STARTER,
    "tests/unit",
    "tests/cli-package.mjs",
    "scripts/mirror-cli",
    "scripts/mirror-cli.mjs",
  ],
  // The starter repo is *only* the docs site, so only its own content and the generator can
  // change what gets published.
  starter: [STARTER, "scripts/mirror-cli.mjs"],
}[TARGET];

/** One-line description of what a snapshot contains, shaped to the target. */
function summarize(info) {
  return TARGET === "starter"
    ? `${info.fileCount} files`
    : `${info.fileCount} mirrored files, ${info.testCount} portable unit tests, v${info.version}`;
}

const log = (m) => console.log(m);
const step = (m) => console.log(`\x1b[36m▶\x1b[0m ${m}`);
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);

function fail(msg) {
  console.error(`\x1b[31mmirror:\x1b[0m ${msg}`);
  process.exit(1);
}

function sh(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
  if (res.status !== 0) {
    fail(`\`${cmd} ${args.join(" ")}\` exited ${res.status}\n${res.stdout ?? ""}${res.stderr ?? ""}`);
  }
  return (res.stdout ?? "").trim();
}

function shSoft(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
  return { code: res.status, out: (res.stdout ?? "").trim(), err: (res.stderr ?? "").trim() };
}

function git(args, cwd = REPO) {
  return sh("git", args, { cwd });
}

// ---------------------------------------------------------------------------
// Snapshot construction
// ---------------------------------------------------------------------------

/**
 * Unit tests that can run in the public repo: the ones covering the renderer or the CLI
 * and nothing else. Computed rather than hardcoded so the set stays current as tests are
 * added — a list in this file would silently rot. Tests that also import the private app
 * (`@/…`) are skipped because that code isn't mirrored.
 */
function portableUnitTests(sha) {
  const files = git(["ls-tree", "-r", "--name-only", sha, "tests/unit/"])
    .split("\n")
    .filter((f) => f.endsWith(".test.ts"));

  // Anything reachable in the public repo. Note `tests/` covers sibling helpers and the
  // fixtures the renderer's own tests read.
  const available = [...MIRRORED_PATHS, ...MIRRORED_TEST_DATA, "tests"];
  const inPublicRepo = (p) =>
    available.some((base) => p === base || p.startsWith(base + "/"));

  return files.filter((file) => {
    const src = git(["show", `${sha}:${file}`]);
    const specifiers = [...src.matchAll(/(?:from|import|require)\s*\(?\s*"([^"]+)"/g)].map(
      (m) => m[1],
    );

    // Resolve relative specifiers rather than pattern-matching them. The first version of
    // this check only rejected the `@/` alias, and `draft-source.test.ts` reached into the
    // private app as `../../src/lib/draft-source` — same problem, different spelling. Path
    // resolution catches both and anything else someone invents.
    const reachesOutside = specifiers.some((spec) => {
      if (spec.startsWith("@/")) return true;
      if (!spec.startsWith(".")) return false;
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
      return !inPublicRepo(resolved);
    });
    if (reachesOutside) return false;

    // Keep only tests that actually cover mirrored code, so the public suite is about the
    // renderer and the CLI rather than whatever else happens to be importable.
    return specifiers.some(
      (s) => s.startsWith("@papervine/renderer") || s.includes("apps/cli/"),
    );
  });
}

/**
 * Copy a path out of git at `sha` into `dest`. Reads from the object store, not the
 * worktree, so the snapshot is exactly the committed state.
 *
 * Modes are carried across deliberately: `git show` gives content only, and writing it
 * with the default mode would drop the executable bit from `bin/papervine.mjs`. npm
 * re-applies it for the published `bin`, so the breakage would only show up for someone
 * running the script directly out of a clone of the public repo.
 */
function extractPath(sha, rel, destRoot) {
  const entries = git(["ls-tree", "-r", sha, rel]).split("\n").filter(Boolean);
  let count = 0;
  for (const entry of entries) {
    const [meta, file] = entry.split("\t");
    const mode = meta.split(" ")[0];
    // Never mirror generated build output, even if it somehow got committed.
    if (/^apps\/cli\/(build|server)\//.test(file)) continue;
    const target = path.join(destRoot, file);
    mkdirSync(path.dirname(target), { recursive: true });
    const res = spawnSync("git", ["show", `${sha}:${file}`], {
      cwd: REPO,
      maxBuffer: 128 * 1024 * 1024,
      encoding: "buffer",
    });
    if (res.status !== 0) fail(`could not read ${file} at ${sha}`);
    writeFileSync(target, res.stdout, { mode: mode === "100755" ? 0o755 : 0o644 });
    count++;
  }
  return count;
}

/** The generated root manifest: a two-package workspace, CLI scripts hoisted to the top. */
function rootPackageJson(cliPkg) {
  return {
    name: "papervine-cli-workspace",
    version: cliPkg.version,
    private: true,
    type: "module",
    description: cliPkg.description,
    license: "Elastic-2.0",
    homepage: cliPkg.homepage,
    repository: cliPkg.repository,
    bugs: cliPkg.bugs,
    workspaces: ["packages/*", "apps/*"],
    scripts: {
      dev: "node apps/cli/bin/papervine.mjs dev",
      prepack: "npm run prepack --workspace papervine",
      typecheck: "tsc --noEmit -p apps/cli/tsconfig.json",
      "test:unit": "vitest run",
      "test:cli": "CLI_PKG_DOCS=examples/starter node tests/cli-package.mjs",
    },
    devDependencies: {
      "@types/node": "22.10.7",
      "@types/react": "19.0.7",
      "@types/react-dom": "19.0.3",
      typescript: "5.7.3",
      vitest: "^4.1.8",
    },
    engines: cliPkg.engines,
  };
}

const ROOT_TSCONFIG = {
  compilerOptions: {
    target: "ES2022",
    lib: ["dom", "dom.iterable", "ES2022"],
    allowJs: true,
    skipLibCheck: true,
    strict: true,
    noEmit: true,
    esModuleInterop: true,
    module: "esnext",
    moduleResolution: "bundler",
    resolveJsonModule: true,
    isolatedModules: true,
    jsx: "react-jsx",
    incremental: true,
  },
  include: ["**/*.ts", "**/*.tsx"],
  exclude: ["node_modules", "apps/cli/build", "apps/cli/server"],
};

const VITEST_CONFIG = `import { defineConfig } from "vitest/config";

// Mirrors the upstream config: the \`server-only\` marker is a build-time RSC boundary
// with no meaning under Node, so it's stubbed out to let the renderer's pure logic be
// unit-tested directly.
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "server-only": new URL("./tests/unit/_server-only-stub.ts", import.meta.url).pathname,
    },
  },
});
`;

const GITIGNORE = `node_modules/
# Generated by the CLI's prepack (the prebuilt renderer that gets published).
apps/cli/build/
apps/cli/server/
*.tgz
*.tsbuildinfo
next-env.d.ts
.DS_Store
.env*.local
`;

/** Build the complete public-repo tree for monorepo commit `sha` into `dest`. */
/** Dispatch to the right builder for `--target`. */
function buildSnapshot(sha, dest) {
  return TARGET === "starter" ? buildStarterSnapshot(sha, dest) : buildCliSnapshot(sha, dest);
}

/**
 * The starter repo is the docs site and nothing else — `examples/starter` lifted to the repo
 * root. No generated manifest, no CI, no lockfile: there's nothing to install or build, which
 * is the point of a docs repo you can fork and immediately render.
 */
function buildStarterSnapshot(sha, dest) {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });

  const staged = path.join(dest, "__staged");
  const fileCount = extractPath(sha, STARTER, staged);
  if (!fileCount) fail(`no files under ${STARTER} at ${sha}`);

  // `extractPath` writes repo-relative paths, so the content lands at
  // <staged>/examples/starter/… — hoist it to the root the forked repo expects.
  for (const entry of readdirSync(path.join(staged, STARTER))) {
    cpSync(path.join(staged, STARTER, entry), path.join(dest, entry), {
      recursive: true,
      dereference: true,
    });
  }
  rmSync(staged, { recursive: true, force: true });

  // A starter template attracts drive-by PRs far more than a CLI does, and every one of them
  // hits the "reviewed here, merged upstream" flow. Explaining that before someone does the
  // work is the whole job of this file — and the Initial-import commit message references it.
  cpSync(
    path.join(TEMPLATES, "CONTRIBUTING-starter.md"),
    path.join(dest, "CONTRIBUTING.md"),
  );

  writeFileSync(path.join(dest, STAMP), `${sha}\n`);
  return { fileCount, version: "" };
}

function buildCliSnapshot(sha, dest) {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });

  let fileCount = 0;
  // `examples/starter` rides along at the same path it has here, so the CLI repo's
  // `npm run dev -- examples/starter` and its `test:cli` fixture are the *same* docs site
  // that gets published to papervine/starter. One copy, no drift.
  for (const rel of [...MIRRORED_PATHS, ...MIRRORED_TEST_DATA, STARTER]) {
    fileCount += extractPath(sha, rel, dest);
  }

  // The CLI's manifest drives the generated root, so they can't drift.
  const cliPkg = JSON.parse(readFileSync(path.join(dest, "apps/cli/package.json"), "utf8"));

  // Tests. The clean-room test is mirrored verbatim (it reads CLI_PKG_DOCS), plus the
  // renderer's portable unit tests and the stub their vitest alias needs.
  mkdirSync(path.join(dest, "tests/unit"), { recursive: true });
  for (const rel of ["tests/cli-package.mjs", "tests/unit/_server-only-stub.ts"]) {
    writeFileSync(path.join(dest, rel), git(["show", `${sha}:${rel}`]));
  }
  const tests = portableUnitTests(sha);
  for (const rel of tests) writeFileSync(path.join(dest, rel), git(["show", `${sha}:${rel}`]));

  // Generated scaffolding.
  writeFileSync(
    path.join(dest, "package.json"),
    JSON.stringify(rootPackageJson(cliPkg), null, 2) + "\n",
  );
  writeFileSync(path.join(dest, "tsconfig.json"), JSON.stringify(ROOT_TSCONFIG, null, 2) + "\n");
  writeFileSync(path.join(dest, "vitest.config.ts"), VITEST_CONFIG);
  writeFileSync(path.join(dest, ".gitignore"), GITIGNORE);
  // One of the MDX dependencies declares an impossible peer range; without this, a plain
  // `npm ci` in the public repo fails outright.
  writeFileSync(path.join(dest, ".npmrc"), "legacy-peer-deps=true\n");
  writeFileSync(path.join(dest, STAMP), `${sha}\n`);

  // README and LICENSE are the CLI's own — the same ones npm shows.
  cpSync(path.join(dest, "apps/cli/README.md"), path.join(dest, "README.md"));
  cpSync(path.join(dest, "apps/cli/LICENSE"), path.join(dest, "LICENSE"));

  cpSync(path.join(TEMPLATES, "CONTRIBUTING.md"), path.join(dest, "CONTRIBUTING.md"));
  mkdirSync(path.join(dest, ".github/workflows"), { recursive: true });
  cpSync(path.join(TEMPLATES, "workflows"), path.join(dest, ".github/workflows"), {
    recursive: true,
  });

  // A lockfile is not optional. `actions/setup-node` with `cache: npm` fails outright
  // without one ("Dependencies lock file is not found") — before `npm ci` even runs — so
  // the public repo's CI is red on arrival. It can't be copied from the monorepo either:
  // that lock describes the whole workspace, including the control plane.
  const lock = shSoft("npm", ["install", "--package-lock-only", "--no-audit", "--no-fund"], {
    cwd: dest,
  });
  if (lock.code !== 0) {
    fail(`could not generate package-lock.json for the snapshot:\n${lock.err || lock.out}`);
  }

  return { fileCount, testCount: tests.length, version: cliPkg.version };
}

// ---------------------------------------------------------------------------
// Validation — the snapshot must stand on its own before it's published
// ---------------------------------------------------------------------------

function validateSnapshot(dir) {
  if (TARGET === "starter") return validateStarterSnapshot(dir);

  step("validating the snapshot (npm ci + typecheck + unit)");
  // `npm ci`, not `npm install` — it's what the public repo's CI runs, and it fails if the
  // generated lockfile is out of sync with the generated package.json rather than quietly
  // fixing it up. That mismatch is the exact thing worth catching here.
  const install = shSoft("npm", ["ci", "--no-audit", "--no-fund"], { cwd: dir });
  if (install.code !== 0) {
    fail(`the generated snapshot does not \`npm ci\`:\n${install.err || install.out}`);
  }
  ok("npm ci");

  for (const [label, args] of [
    ["typecheck", ["run", "typecheck"]],
    ["unit tests", ["run", "test:unit"]],
  ]) {
    const res = shSoft("npm", args, { cwd: dir });
    if (res.code !== 0) fail(`snapshot ${label} failed:\n${res.out}\n${res.err}`);
    ok(label);
  }
  log("  (test:cli is left to the public repo's CI — it runs a full build)");
}

/**
 * There is nothing to install or typecheck in a docs repo, so validate what can actually be
 * wrong: `docs.json` has to parse, and every page its navigation names has to exist. A nav
 * entry pointing at a deleted file is the realistic breakage here — it renders as a 404 in a
 * repo people fork, and nothing else would catch it before they did.
 *
 * Full rendering is covered by `node tests/crawl.mjs examples/starter` in CI, which serves the
 * site through the real renderer.
 */
function validateStarterSnapshot(dir) {
  step("validating the snapshot (docs.json + every page it references)");

  const configPath = path.join(dir, "docs.json");
  if (!existsSync(configPath)) fail(`no docs.json in the snapshot`);
  let config;
  try {
    config = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (err) {
    fail(`docs.json does not parse: ${err.message}`);
  }
  ok("docs.json parses");

  const slugs = new Set();
  (function walk(node) {
    if (typeof node === "string") return slugs.add(node);
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === "object") {
      for (const key of ["tabs", "groups", "pages", "navigation", "anchors"]) {
        if (node[key]) walk(node[key]);
      }
    }
  })(config.navigation ?? config);

  const missing = [...slugs].filter(
    (slug) => !existsSync(path.join(dir, `${slug}.mdx`)) && !existsSync(path.join(dir, `${slug}.md`)),
  );
  if (missing.length) {
    fail(`docs.json references pages that don't exist:\n  ${missing.join("\n  ")}`);
  }
  ok(`${slugs.size} navigation pages all present`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// `--from` names the source commit explicitly. Handy for re-publishing an older commit,
// and for testing an unpublished change: `--from "$(git stash create)"` snapshots the
// working tree via a dangling commit, without touching any ref or the shared stash stack.
const FROM = val("--from", null);

// Otherwise a snapshot is built from HEAD, so a dirty tree would mean the thing you
// publish isn't the thing you're looking at. Refuse rather than surprise.
if (!FROM && git(["status", "--porcelain"])) {
  fail(
    "the monorepo has uncommitted changes — commit them first.\n" +
      `  To preview an uncommitted change instead:\n` +
      `    node scripts/mirror-cli.mjs --dry-run --from "$(git stash create)"`,
  );
}
const headSha = FROM ? git(["rev-parse", FROM]) : git(["rev-parse", "HEAD"]);

const WORK = mkdtempSync(path.join(realpathSync(os.tmpdir()), "papervine-mirror-"));
const STAGE = path.join(WORK, "stage");

try {
  if (DRY_RUN) {
    step(`building snapshot of ${headSha.slice(0, 12)} (dry run)`);
    const info = buildSnapshot(headSha, STAGE);
    ok(summarize(info));
    if (VALIDATE) validateSnapshot(STAGE);
    log(`\nSnapshot left at:\n  ${STAGE}\n`);
    log("Nothing was pushed. Re-run without --dry-run to publish.");
    process.exit(0);
  }

  step(`cloning ${REMOTE}`);
  const PUBLIC = path.join(WORK, "public");
  const clone = shSoft("git", ["clone", REMOTE, PUBLIC]);
  const isEmpty = clone.code !== 0 || !existsSync(path.join(PUBLIC, ".git"));

  if (isEmpty && !INITIAL) {
    fail(
      `could not clone ${REMOTE} (or it is empty).\n` +
        `  If this is the first publish, create the repo and re-run with --initial.\n` +
        `  git said: ${clone.err.split("\n")[0]}`,
    );
  }

  // `--initial` means "squash into one commit instead of replaying history" — it says
  // nothing about whether the remote already has commits. A freshly created GitHub repo
  // usually does (the "add a license" checkbox makes one), so when the remote is clonable
  // we build on top of it. Starting a detached history instead would make the push a
  // non-fast-forward, and the only ways out of that are force-pushing over someone's repo
  // or an unrelated-histories merge — neither of which should happen silently.
  let freshRepo = false;
  if (isEmpty) {
    rmSync(PUBLIC, { recursive: true, force: true });
    mkdirSync(PUBLIC, { recursive: true });
    git(["init", "-b", "main"], PUBLIC);
    git(["remote", "add", "origin", REMOTE], PUBLIC);
    freshRepo = true;
    ok("target repo is empty — initializing a new history");
  } else {
    ok(`cloned (HEAD ${git(["rev-parse", "--short", "HEAD"], PUBLIC)})`);
  }

  // --- The divergence guard -------------------------------------------------
  //
  // If the public repo's tree isn't exactly what this script last produced, someone has
  // committed there directly — most likely by merging a PR. Publishing now would revert
  // their work silently, so stop and say what to do instead.
  let lastSha = null;
  if (!INITIAL) {
    const stampPath = path.join(PUBLIC, STAMP);
    if (!existsSync(stampPath)) {
      fail(
        `${STAMP} is missing from the public repo, so I can't tell what it reflects.\n` +
          `  If it was published before this script existed, re-run with --initial.`,
      );
    }
    lastSha = readFileSync(stampPath, "utf8").trim();

    // Ask the only question that matters: was the public repo's tip written by this script?
    //
    // This *used* to rebuild the snapshot for `lastSha` and diff it against the public tree,
    // which was wrong in a way that took a real run to expose. The rebuild uses the CURRENT
    // generator, so any change to the generated part of a snapshot — adding CONTRIBUTING.md,
    // in the event that caught it — makes the rebuild legitimately differ and the guard cries
    // wolf. A guard that cries wolf is worse than none: the documented escape is `--initial`,
    // so a false positive trains you to bypass the exact check protecting the repo.
    //
    // Every commit written here carries a `Mirrored-From:` trailer. A merge, squash-merge or
    // hand-edit on the public repo produces a tip without it — which is precisely the
    // condition worth refusing on, needs no rebuild, and can't be confused by generator
    // changes.
    step("checking the public repo's tip is ours");
    const tipMessage = git(["log", "-1", "--format=%B"], PUBLIC);
    const isOurs =
      tipMessage.includes(MIRROR_TRAILER) || LEGACY_TRAILERS.some((t) => tipMessage.includes(t));
    if (!isOurs) {
      const tipSubject = git(["log", "-1", "--format=%h %an: %s"], PUBLIC);
      fail(
        `the public repo's tip was not written by this script:\n\n  ${tipSubject}\n\n` +
          `  Almost certainly a PR was merged there. Nothing has been changed. Port those\n` +
          `  commits into the monorepo first (preserving authorship: \`git cherry-pick\` or\n` +
          `  \`git am\`, keeping --author), then re-run. Publishing over them would silently\n` +
          `  revert that work, which is exactly what this check exists to prevent.`,
      );
    }
    ok(`tip is ours (reflects ${lastSha.slice(0, 12)})`);
  }

  // --- Replay ---------------------------------------------------------------
  //
  // One public commit per monorepo commit that touched a mirrored path, keeping the
  // original author, date and message. That gives the public repo real history and gives
  // contributors real credit — including on their GitHub contribution graph, which is what
  // makes "reviewed here, merged upstream" a fair deal rather than an insult.
  const range = lastSha ? `${lastSha}..${headSha}` : headSha;
  const commits = INITIAL
    ? [headSha]
    : git(["log", "--reverse", "--format=%H", range, "--", ...SOURCE_PATHS])
        .split("\n")
        .filter(Boolean);

  if (!commits.length) {
    log("\nNothing to publish — no commits touching the mirrored paths since the last run.");
    process.exit(0);
  }
  step(`replaying ${commits.length} commit(s)`);

  let published = 0;
  for (const sha of commits) {
    const [author, email, date, subject] = [
      git(["show", "-s", "--format=%an", sha]),
      git(["show", "-s", "--format=%ae", sha]),
      git(["show", "-s", "--format=%aI", sha]),
      git(["show", "-s", "--format=%s", sha]),
    ];
    const body = git(["show", "-s", "--format=%b", sha]);

    const info = buildSnapshot(sha, STAGE);

    // Replace the tracked tree wholesale, so deletions upstream become deletions here.
    for (const entry of readdirSync(PUBLIC)) {
      if (entry === ".git") continue;
      rmSync(path.join(PUBLIC, entry), { recursive: true, force: true });
    }
    cpSync(STAGE, PUBLIC, { recursive: true });

    git(["add", "-A"], PUBLIC);
    if (!shSoft("git", ["diff", "--cached", "--quiet"], { cwd: PUBLIC }).code) continue; // no-op

    const message = INITIAL
      ? `Initial import\n\nPublished from the Papervine monorepo.\n` +
        `See CONTRIBUTING.md for how changes flow between the two repositories.\n\n` +
        `${MIRROR_TRAILER} ${sha}\n`
      : `${subject}\n\n${body ? body + "\n\n" : ""}${MIRROR_TRAILER} ${sha}\n`;

    git(
      [
        "-c",
        `user.name=${author}`,
        "-c",
        `user.email=${email}`,
        "commit",
        "--author",
        `${author} <${email}>`,
        "--date",
        date,
        "-m",
        message,
      ],
      PUBLIC,
    );
    published++;
    // Report the message actually being written, not the upstream subject — on `--initial`
    // those differ (the snapshot is squashed into one "Initial import"), and printing the
    // upstream subject made it look like the wrong thing had been published.
    log(`  ${published}/${commits.length} ${message.split("\n")[0].slice(0, 68)}`);
    if (INITIAL) {
      ok(summarize(info));
    }
  }

  if (!published) {
    log("\nNothing to publish — the mirrored paths are already up to date.");
    process.exit(0);
  }

  if (VALIDATE) validateSnapshot(PUBLIC);

  if (DO_PUSH) {
    step("pushing");
    // Never force: a force-push would break open PRs' ability to rebase, and would hide
    // exactly the divergence the guard above is meant to surface.
    const push = shSoft("git", ["push", freshRepo ? "-u" : "--", "origin", "main"], {
      cwd: PUBLIC,
    });
    if (push.code !== 0) fail(`push failed:\n${push.err || push.out}`);
    ok(`pushed ${published} commit(s) to ${REMOTE}`);
  } else {
    log(`\n${published} commit(s) staged locally, not pushed. To push:`);
    log(`  git -C ${PUBLIC} push ${freshRepo ? "-u " : ""}origin main`);
    log(`\nOr re-run with --push. Inspect first with:  git -C ${PUBLIC} log --oneline`);
  }
} finally {
  if (KEEP || DRY_RUN) log(`\n(work directory kept: ${WORK})`);
  else rmSync(WORK, { recursive: true, force: true });
}
