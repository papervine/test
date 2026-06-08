import { defineConfig } from "vitest/config";

// Fast, infra-free unit tests for pure logic (no DB, no browser). E2E lives in
// tests/e2e (Playwright); the renderer/gate smoke gate is tests/smoke.mjs.
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: { "@": new URL("./src", import.meta.url).pathname },
  },
});
