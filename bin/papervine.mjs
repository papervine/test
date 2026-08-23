#!/usr/bin/env node
// Papervine dev preview — the CONTRIBUTOR tool, run as `npm run papervine -- dev <dir>`
// or `node bin/papervine.mjs dev <dir>`. It boots the *monorepo's* app (control plane
// included) against a content dir, so you get `next dev` and real HMR while working on
// the renderer.
//
// This is NOT the published CLI. That one is `apps/cli/bin/papervine.mjs` — what
// `npx papervine` runs: a lean, prebuilt, renderer-only package with no control plane
// (SPEC §10.6). The two are intentionally different programs; if you are changing what
// end users get, you want the other file.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

// The Papervine package root — where next.config / the app live. The renderer
// always runs from here; only the *content* dir varies per invocation.
const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fail(msg) {
  console.error(`\x1b[31mpapervine:\x1b[0m ${msg}`);
  process.exit(1);
}

function printHelp() {
  console.log(`papervine — open-source docs renderer

Usage:
  papervine dev [dir]        Preview the docs in [dir] (default: current directory)

Options:
  -p, --port <port>       Port to serve on (default: 3000)
  -h, --help              Show this help

Examples:
  papervine dev              # preview ./ (must contain docs.json)
  papervine dev ./docs       # preview ./docs
  papervine dev -p 4000      # preview on port 4000
`);
}

function runDev(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      port: { type: "string", short: "p" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    printHelp();
    return;
  }

  const contentDir = path.resolve(positionals[0] ?? process.cwd());

  if (!existsSync(contentDir)) {
    fail(`directory not found: ${contentDir}`);
  }
  if (!existsSync(path.join(contentDir, "docs.json"))) {
    fail(
      `no docs.json in ${contentDir}\n` +
        `  A Papervine/docs.json docs repo needs a docs.json at its root.`,
    );
  }

  const nextBin = path.join(
    PKG_ROOT,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "next.cmd" : "next",
  );
  if (!existsSync(nextBin)) {
    fail(`renderer not installed — run \`npm install\` in ${PKG_ROOT}`);
  }

  const args = ["dev"];
  if (values.port) args.push("-p", values.port);

  console.log(`\x1b[32m▲ papervine\x1b[0m serving \x1b[1m${contentDir}\x1b[0m`);

  const child = spawn(nextBin, args, {
    cwd: PKG_ROOT,
    stdio: "inherit",
    env: { ...process.env, PAPERVINE_CONTENT: contentDir },
  });

  const forward = (sig) => () => child.kill(sig);
  process.on("SIGINT", forward("SIGINT"));
  process.on("SIGTERM", forward("SIGTERM"));
  child.on("exit", (code) => process.exit(code ?? 0));
}

const [, , command, ...rest] = process.argv;

if (!command || command === "-h" || command === "--help" || command === "help") {
  printHelp();
} else if (command === "dev") {
  runDev(rest);
} else {
  fail(`unknown command "${command}". Run \`papervine --help\`.`);
}
