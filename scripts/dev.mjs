#!/usr/bin/env node
// `npm run dev` — the local stack, as a small process manifest.
//
// The default command should yield a *working product*, not a bare web server: docker
// services (Postgres + MinIO), the Next app, and the Trigger.dev worker (automations
// and cron ticks only execute while it's connected — a missing worker is silently
// confusing, which is exactly why it belongs in the default).
//
// Peripheral layers attach by DECLARED INTENT rather than a hardcoded list: a process
// starts only when its configuration is present, because configuring it *is* the
// signal that you're working on it. Stripe is the current example — a Day-1
// contributor with no Stripe keys never sees a word about it; a dev who has set them
// gets webhook forwarding automatically. Partially-configured layers print one hint
// line with the exact fix instead of failing mysteriously.
//
// Every layer degrades independently. Only the web process is load-bearing: if it
// exits, the stack comes down; anything else dying just prints its exit and the site
// keeps running. `npm run dev:app` is the bare app loop (and what this spawns).
//
// Zero dependencies: plain spawn + prefixed output.
//
// Run it via `npm run dev`, which passes `--env-file-if-exists=.env.local`: every when()
// below reads process.env, and Node does NOT load .env.local on its own. Without that flag
// the whole declared-intent mechanism is inert for anyone who keeps config in .env.local —
// which is exactly where this repo says to put it — so layers silently never start and their
// hints never fire either (each hint short-circuits on the same var it's reporting about).
// `-if-exists` rather than `--env-file` so a fresh clone with no .env.local still boots.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";
const BLUE = "\x1b[34m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

const root = process.cwd();
const PORT = process.env.PORT ?? "3000";
const has = (name) => !!process.env[name]?.trim();
const onPath = (bin) => spawnSync("which", [bin], { stdio: "ignore" }).status === 0;

// --- the manifest -----------------------------------------------------------------
// when() decides whether the layer belongs in THIS developer's stack; hint() (optional)
// returns a one-line nudge printed when the layer is skipped but looks half-configured.
const LAYERS = [
  {
    tag: "web",
    color: CYAN,
    required: true, // its exit ends the session
    when: () => true,
    cmd: "npm",
    args: ["run", "dev:app"],
  },
  {
    tag: "worker",
    color: MAGENTA,
    // The automations executor (SPEC §10.2). Present in-repo, so effectively always on;
    // without a `trigger.dev login` it exits with its own instructions and the app lives.
    // Caveat: two worktrees running workers share one Trigger.dev dev environment, so
    // cron ticks may execute against whichever connected last. Fine for one developer.
    when: () => existsSync(join(root, "trigger.config.ts")),
    cmd: "npx",
    args: [
      "trigger.dev@latest",
      "dev",
      "start",
      "--env-file",
      ".env.local",
      "--skip-update-check",
    ],
  },
  {
    tag: "smee",
    color: GREEN,
    // GitHub App webhook delivery (SPEC §3). GitHub's servers can't reach localhost, so a
    // relay is the only way to exercise push auto-sync and uninstall cleanup locally.
    //
    // This matters more than it looks: `publishDraft`'s commit mode SKIPS its inline sync
    // whenever the App is configured, on the assumption that the push webhook will do it
    // (authoring-core.ts). So with GITHUB_APP_ID set and no relay running, publishing from
    // Studio commits to GitHub and then the site silently never updates until someone hits
    // Re-sync. Hence the hint below fires loudly rather than staying quiet.
    //
    // Only the webhook needs relaying: the App's Setup URL redirects the BROWSER, so
    // http://app.localhost:PORT/api/github/setup works untunnelled, and that callback is
    // what links an installation to an org.
    when: () => has("GITHUB_APP_ID") && has("GITHUB_APP_WEBHOOK_PROXY_URL"),
    cmd: "npx",
    args: [
      "--yes",
      "smee-client@latest",
      "--url",
      process.env.GITHUB_APP_WEBHOOK_PROXY_URL ?? "",
      "--target",
      `http://127.0.0.1:${PORT}/api/github/webhook`,
    ],
    hint: () => {
      if (!has("GITHUB_APP_ID")) return null; // no GitHub App work — stay quiet
      return (
        "GITHUB_APP_ID is set but GITHUB_APP_WEBHOOK_PROXY_URL isn't, so GitHub webhooks " +
        "can't reach you: pushes won't auto-sync, and publishing from Studio will commit " +
        "but leave the site stale until a manual Re-sync. Start a channel at https://smee.io, " +
        "set it as the App's webhook URL, and put it in .env.local."
      );
    },
  },
  {
    tag: "autumn",
    color: YELLOW,
    // Autumn → Papervine webhook delivery (SPEC §10 Billing). Autumn's servers can't reach
    // localhost either, so without a relay a plan change made in the sandbox dashboard only
    // shows up locally when the 60s billing cache expires — and the realtime "unlock card
    // becomes the page" refresh never fires. `svix listen` is the Svix analogue of
    // `stripe listen`: a public Play URL that forwards POSTs (headers intact, so the
    // signature still verifies) to the local route. `--token` reconnects to the SAME Play
    // URL every start, which is what lets the endpoint be registered in Autumn once.
    when: () =>
      has("AUTUMN_WEBHOOK_SECRET") && has("AUTUMN_WEBHOOK_PLAY_TOKEN") && onPath("svix"),
    cmd: "svix",
    args: [
      "listen",
      "--token",
      process.env.AUTUMN_WEBHOOK_PLAY_TOKEN ?? "",
      `http://127.0.0.1:${PORT}/api/webhooks/autumn`,
    ],
    hint: () => {
      if (!has("AUTUMN_SECRET_KEY")) return null; // no billing work — stay quiet
      if (!onPath("svix")) {
        return (
          "AUTUMN_SECRET_KEY is set but the svix CLI isn't installed, so Autumn webhooks " +
          "can't reach you: sandbox plan changes show up only after the billing cache " +
          "expires. `brew install svix/svix/svix-cli`, then see docs/control-plane/billing-operations."
        );
      }
      return (
        "AUTUMN_SECRET_KEY is set but AUTUMN_WEBHOOK_SECRET / AUTUMN_WEBHOOK_PLAY_TOKEN " +
        "aren't, so Autumn webhooks can't reach you. Run `svix listen http://127.0.0.1:" +
        PORT +
        "/api/webhooks/autumn` once, register the printed Play URL as a sandbox webhook " +
        "endpoint in Autumn, and put its token + the endpoint secret in .env.local."
      );
    },
  },
];

// --- runner -----------------------------------------------------------------------
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

const children = [];
let shuttingDown = false;

// Kill the child's whole PROCESS GROUP, not just the child. `npm run …` and
// `npx …` are wrappers that spawn the real server/worker as grandchildren; signalling
// only the wrapper leaves those orphaned, still holding the port and (for the worker)
// still connected to Trigger.dev. Children are spawned `detached: true` so each leads
// its own group, and negative-PID kill signals the entire group.
function killTree(child, signal) {
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // already gone
    }
  }
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) killTree(c, "SIGINT");
  // Anything still alive after the grace period gets SIGKILL — an orphaned dev server
  // holds the port and the next `npm run dev` silently picks a different one.
  setTimeout(() => {
    for (const c of children) killTree(c, "SIGKILL");
    process.exit(code);
  }, 1500);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

// Docker services first — idempotent, and a warning rather than a wall: the renderer
// works without a database (that no-DB survival is a hard rule; see tests/smoke.mjs).
const compose = spawnSync("docker", ["compose", "up", "-d"], { stdio: "inherit" });
if (compose.status !== 0) {
  console.warn(
    `${YELLOW}[dev]${RESET} docker compose failed or docker isn't running — the control plane` +
      ` degrades to no-DB mode (the renderer still works).`,
  );
}

for (const layer of LAYERS) {
  if (!layer.when()) {
    const hint = layer.hint?.();
    if (hint) console.log(`${YELLOW}[dev]${RESET} ${hint}`);
    continue;
  }
  const child = spawn(layer.cmd, layer.args, {
    stdio: ["ignore", "pipe", "pipe"],
    detached: true, // own process group → killTree can take down the wrapper's children
  });
  prefix(layer.tag, layer.color, child.stdout, process.stdout);
  prefix(layer.tag, layer.color, child.stderr, process.stderr);
  child.on("error", (err) => {
    console.warn(`${YELLOW}[dev]${RESET} could not start ${layer.tag}: ${err.message}`);
    if (layer.required) shutdown(1);
  });
  child.on("exit", (code) => {
    console.log(`${layer.color}[${layer.tag}]${RESET} exited (${code ?? "signal"})`);
    if (layer.required) shutdown(code ?? 0);
  });
  children.push(child);
}

console.log(
  `${DIM}[dev] running ${children.length} process(es) — \`npm run dev:app\` for the app alone.${RESET}`,
);
