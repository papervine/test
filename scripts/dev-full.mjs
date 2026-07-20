#!/usr/bin/env node
// The whole local stack in one command: docker services (Postgres + MinIO), the Next
// dev server, and the Trigger.dev worker (the automations executor's local engine —
// cron ticks and runs only execute while it's connected). Zero deps: plain spawn with
// prefixed output. Each piece degrades independently: no docker → warn (renderer-only
// work is fine without it); no trigger login/config → warn (automations just won't
// execute). `npm run dev` stays the minimal renderer-only loop.
import { spawn, spawnSync } from "node:child_process";

const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

function prefix(tag, color, stream, out) {
  let buf = "";
  stream.on("data", (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      out.write(`${color}[${tag}]${RESET} ${buf.slice(0, i)}\n`);
      buf = buf.slice(i + 1);
    }
  });
}

// 1. Docker services — idempotent; a warning, not a wall, when docker isn't around.
const compose = spawnSync("docker", ["compose", "up", "-d"], { stdio: "inherit" });
if (compose.status !== 0) {
  console.warn(
    `${YELLOW}[dev:full] docker compose failed or docker is not running — the control plane` +
      ` will degrade to no-DB mode (renderer still works).${RESET}`,
  );
}

const children = [];
function launch(tag, color, cmd, args) {
  const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
  prefix(tag, color, child.stdout, process.stdout);
  prefix(tag, color, child.stderr, process.stderr);
  child.on("exit", (code) => {
    console.log(`${color}[${tag}]${RESET} exited (${code ?? "signal"})`);
    // The web server is the session: when it goes, take everything down. The worker
    // dying alone just means automations pause — keep the site running.
    if (tag === "web") shutdown(code ?? 0);
  });
  children.push(child);
  return child;
}

let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) c.kill("SIGINT");
  // Give children a moment to die gracefully before we go.
  setTimeout(() => process.exit(code), 1500);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

// 2. The app — via `npm run dev` so it inherits that script's exact flags (turbopack).
launch("web", CYAN, "npm", ["run", "dev"]);

// 3. The automations executor worker. Needs a one-time `npx trigger.dev login` and a
// trigger.config.ts; without them it exits with a clear message and the rest lives on.
launch("worker", MAGENTA, "npx", [
  "trigger.dev@latest",
  "dev",
  "start",
  "--env-file",
  ".env.local",
  "--skip-update-check",
]);
