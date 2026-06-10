#!/usr/bin/env node
// Clean restart: kill whatever is serving on PORT, wipe the (possibly
// corrupted) `.next` build cache, then start a single dev server. Use this
// when a chunk/manifest collision already happened and pages won't load.
import { createConnection } from "node:net";
import { spawn, execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = Number(process.env.PORT ?? 3000);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function portInUse(port) {
  return new Promise((resolve) => {
    const sock = createConnection({ port, host: "127.0.0.1" });
    sock.setTimeout(800);
    sock.once("connect", () => {
      sock.destroy();
      resolve(true);
    });
    sock.once("timeout", () => {
      sock.destroy();
      resolve(false);
    });
    sock.once("error", () => resolve(false));
  });
}

// Kill any process listening on PORT (the stale dev server). `lsof` works on
// macOS and Linux; ignore failures (nothing listening / not installed).
try {
  const pids = execFileSync("lsof", ["-ti", `tcp:${PORT}`], { encoding: "utf8" })
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const pid of pids) {
    try {
      process.kill(Number(pid), "SIGKILL");
      console.log(`✗ killed stale process ${pid} on :${PORT}`);
    } catch {}
  }
} catch {}

// Wait for the port to actually free up before reclaiming it.
for (let i = 0; i < 20 && (await portInUse(PORT)); i++) {
  await new Promise((r) => setTimeout(r, 100));
}

console.log("✗ clearing .next/");
rmSync(join(root, ".next"), { recursive: true, force: true });

console.log(`→ starting fresh dev server on :${PORT}`);
const child = spawn("next", ["dev"], { stdio: "inherit", env: process.env });
child.on("exit", (code) => process.exit(code ?? 0));
