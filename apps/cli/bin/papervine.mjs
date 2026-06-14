#!/usr/bin/env node
// Papervine CLI — `papervine dev` previews any docs repo locally, the `mint dev`
// analogue: run it in a folder of MDX + docs.json and it boots the Papervine
// renderer pointed at that folder (SPEC §10.6). A local dev tool only — it ships
// the renderer, never the hosted control plane.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

// The CLI package root — where next.config / the renderer app live. The renderer
// always runs from here; only the *content* dir varies per invocation.
const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fail(msg) {
  console.error(`\x1b[31mpapervine:\x1b[0m ${msg}`);
  process.exit(1);
}

function printHelp() {
  console.log(`papervine — open-source docs renderer (docs.json-compatible)

Usage:
  papervine dev [dir]        Preview the docs in [dir] (default: current directory)

Options:
  -p, --port <port>       Port to serve on (default: 3000)
  -h, --help              Show this help

Examples:
  papervine dev              # preview ./ (must contain docs.json)
  papervine dev ./docs       # preview ./docs
  papervine dev -p 4000      # preview on port 4000

Note: papervine dev compiles and runs the repo's MDX (arbitrary JSX/JS), exactly
like 'mint dev'. Only run it on docs repos you trust.
`);
}

// Resolve the Next.js CLI through Node's resolver so it works whether `next` is
// hoisted to the workspace root (dev) or installed beside this package (npx).
function resolveNextBin() {
  const require = createRequire(import.meta.url);
  try {
    return require.resolve("next/dist/bin/next");
  } catch {
    return null;
  }
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
        `  A Papervine docs repo needs a docs.json at its root.`,
    );
  }

  const nextBin = resolveNextBin();
  if (!nextBin) {
    fail(`renderer not installed — could not resolve "next" from ${PKG_ROOT}`);
  }

  const args = [nextBin, "dev"];
  if (values.port) args.push("-p", values.port);

  console.log(`\x1b[32m▲ papervine\x1b[0m serving \x1b[1m${contentDir}\x1b[0m`);

  const child = spawn(process.execPath, args, {
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
