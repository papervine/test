#!/usr/bin/env node
/**
 * Run Trigger.dev locally, instead of against their hosted cloud.
 *
 * By default `trigger.dev dev` connects your local worker to the HOSTED dev environment: the SDK
 * and CLI both fall back to `https://api.trigger.dev` when `TRIGGER_API_URL` is unset, and the
 * `tr_dev_*` key in `.env.local` is a cloud key. Enqueues leave your machine, get queued there,
 * and are dispatched back. This points the whole thing at a self-hosted stack instead.
 *
 *   npm run trigger:local up      # fetch (once) and start it
 *   npm run trigger:local logs    # follow the webapp log — the magic-link login lands here
 *   npm run trigger:local down    # stop it (add --wipe to delete its data too)
 *
 * WHAT THIS IS NOT: a fork of their stack. Trigger's self-hosted setup is ~9 containers
 * (webapp, postgres, redis, clickhouse, electric, registry, minio, docker-proxy, supervisor),
 * every image already pinned through an env var, and their docs are explicit that the version
 * must stay locked to your CLI version. Vendoring 11KB of somebody else's compose into this repo
 * would mean re-syncing it by hand on every upgrade and getting it subtly wrong once. So this
 * fetches THEIR files at a pinned tag into a gitignored directory and runs them unmodified;
 * upgrading is one constant below.
 *
 * It is a separate stack from `docker compose up` on purpose. Trigger's Postgres must not be the
 * one `db:seed` truncates, and its MinIO must not be the bucket the content sync writes to.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, ".trigger-local");
const STACK = path.join(DIR, "hosting", "docker");

/**
 * Keep this locked to the `trigger.dev` CLI version the repo uses (see the worker layer in
 * scripts/dev.mjs, and @trigger.dev/sdk in package.json). Their docs are explicit that a
 * self-hosted webapp and the CLI talking to it must be the same version.
 */
const TAG = process.env.TRIGGER_IMAGE_TAG ?? "v4.5.14";

const WEBAPP_PORT = 8030;

/**
 * Their two compose files, plus our one small override (docker/trigger-local.override.yml —
 * their MinIO publishes the same ports as ours). Paths are absolute because compose resolves
 * relative ones against the first file's directory, which is inside the fetched stack.
 */
const FILES = [
  "-f",
  "webapp/docker-compose.yml",
  "-f",
  "worker/docker-compose.yml",
  "-f",
  path.join(ROOT, "docker", "trigger-local.override.yml"),
];

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: STACK, ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

/** Their compose files, fetched once. A sparse shallow clone — the repo is large. */
function fetchStack() {
  if (existsSync(STACK)) return;
  console.log(`fetching trigger.dev ${TAG} hosting files…`);
  mkdirSync(DIR, { recursive: true });
  const git = (args) => run("git", args, { cwd: DIR });
  git(["init", "-q"]);
  git(["remote", "add", "origin", "https://github.com/triggerdotdev/trigger.dev.git"]);
  git(["config", "core.sparseCheckout", "true"]);
  git(["sparse-checkout", "set", "hosting/docker"]);
  git(["fetch", "--depth", "1", "origin", `refs/tags/${TAG}`]);
  git(["checkout", "FETCH_HEAD"]);
}

/** Their generator fills the stack's own secrets. Idempotent — it never overwrites one. */
function ensureSecrets() {
  const env = path.join(STACK, ".env");
  if (!existsSync(env)) {
    run("cp", [".env.example", ".env"]);
  }
  run("./generate-secrets.sh", []);
}

const [command = "up", ...rest] = process.argv.slice(2);

if (command === "up") {
  fetchStack();
  ensureSecrets();
  // The combined webapp + worker invocation from their docs: one machine, both halves.
  run("docker", ["compose", ...FILES, "up", "-d", ...rest]);
  console.log(`
Trigger is starting at http://localhost:${WEBAPP_PORT}

Next, once:
  1. Open it and sign in — it emails a magic link, which is printed to the container log:
       npm run trigger:local logs
  2. Create an organization and a project, then copy its ref (proj_…) and a dev API key.
  3. Add both to .env.local, so the SDK, the CLI worker and trigger.config.ts all agree:
       TRIGGER_API_URL=http://localhost:${WEBAPP_PORT}
       TRIGGER_PROJECT_REF=proj_…
       TRIGGER_SECRET_KEY=tr_dev_…
  4. Restart \`npm run dev\`.

The project ref matters: trigger.config.ts falls back to the hosted project when
TRIGGER_PROJECT_REF is unset, so without it the CLI would register your tasks locally against a
project that only exists in the cloud.`);
} else if (command === "down") {
  if (!existsSync(STACK)) process.exit(0);
  const wipe = rest.includes("--wipe");
  // `-v` drops its volumes: its postgres, its clickhouse, its registry. Nothing of ours is in
  // there, which is the point of keeping the stacks separate.
  run("docker", ["compose", ...FILES, "down", ...(wipe ? ["-v"] : [])]);
  if (wipe) {
    rmSync(DIR, { recursive: true, force: true });
    console.log("removed .trigger-local — the next `up` re-fetches it");
  }
} else if (command === "logs") {
  run("docker", ["compose", ...FILES, "logs", "-f", "webapp"]);
} else {
  console.error(`unknown command "${command}" — expected up, down, or logs`);
  process.exit(1);
}
