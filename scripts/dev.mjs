#!/usr/bin/env node
// Singleton dev server.
//
// Multiple `npm run dev` invocations at once (several agents working in
// parallel) used to spawn competing `next dev` processes that wrote to the
// same `.next` directory and clobbered each other's build manifest + chunk
// files. The processes didn't die — the survivor just kept serving references
// to chunks that no longer existed, so pages errored and nothing loaded until
// a manual restart.
//
// This guard makes `npm run dev` idempotent: if something is already serving
// on PORT, reuse it (no-op); otherwise start one. Run `npm run dev:fresh` to
// kill + clear `.next` + restart clean if a collision already corrupted it.
import { createConnection } from "node:net";
import { spawn } from "node:child_process";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = "127.0.0.1";

function portInUse(port, host) {
  return new Promise((resolve) => {
    const sock = createConnection({ port, host });
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

const busy = await portInUse(PORT, HOST);
if (busy) {
  console.log(`✓ dev server already running at http://localhost:${PORT} — reusing it.`);
  console.log(`  (run \`npm run dev:fresh\` to kill it, clear .next, and restart clean)`);
  process.exit(0);
}

const child = spawn("next", ["dev"], { stdio: "inherit", env: process.env });
child.on("exit", (code) => process.exit(code ?? 0));
