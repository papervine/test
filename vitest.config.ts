import { defineConfig } from "vitest/config";

// Fast, infra-free unit tests for pure logic (no DB, no browser). E2E lives in
// tests/e2e (Playwright); the renderer/gate smoke gate is tests/smoke.mjs.
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
      // Neutralize the `server-only` import guard so we can unit-test pure logic that
      // lives in server-marked modules (search/content/nav). It's a build-time RSC
      // boundary marker, irrelevant under Node test.
      "server-only": new URL("./tests/unit/_server-only-stub.ts", import.meta.url).pathname,
    },
  },
});
