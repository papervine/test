import { describe, it, expect } from "vitest";
import { contentContext, type ContentSource } from "@papervine/renderer/lib/content";
import { apiOperations } from "@papervine/renderer/lib/openapi";

// The Try-it modal renders an auth input per security scheme (basic → username + password,
// bearer/oauth2 → a token, apiKey → a header/query value). That needs `apiOperations` to resolve
// each operation's `security` against `components.securitySchemes` into `op.auth`. Guard the
// mapping — a miss silently drops the Authorization section from the playground.

function specSource(specPath: string, spec: object): ContentSource {
  return {
    async loadConfig() {
      throw new Error("unused");
    },
    async loadPage() {
      return null;
    },
    async listPageSlugs() {
      return [];
    },
    async loadRaw(p) {
      return p === specPath ? JSON.stringify(spec) : null;
    },
  };
}

async function authFor(specPath: string, spec: object) {
  const ops = await contentContext.run(specSource(specPath, spec), () => apiOperations(specPath));
  return ops[0].auth;
}

describe("apiOperations resolves security schemes into op.auth", () => {
  const base = {
    openapi: "3.0.0",
    security: [{ scheme: [] }],
    paths: { "/x": { get: { operationId: "x" } } },
  };

  it("maps http basic to a basic scheme", async () => {
    const auth = await authFor("basic.json", {
      ...base,
      components: { securitySchemes: { scheme: { type: "http", scheme: "basic" } } },
    });
    expect(auth).toEqual([{ key: "scheme", type: "basic", description: undefined }]);
  });

  it("maps http bearer to a bearer scheme", async () => {
    const auth = await authFor("bearer.json", {
      ...base,
      components: { securitySchemes: { scheme: { type: "http", scheme: "bearer" } } },
    });
    expect(auth[0].type).toBe("bearer");
  });

  it("maps apiKey, carrying its location and header name", async () => {
    const auth = await authFor("apikey.json", {
      ...base,
      components: {
        securitySchemes: { scheme: { type: "apiKey", in: "header", name: "X-Api-Key" } },
      },
    });
    expect(auth[0]).toMatchObject({ type: "apiKey", in: "header", name: "X-Api-Key" });
  });

  it("returns no auth when the spec declares no security", async () => {
    const auth = await authFor("none.json", {
      openapi: "3.0.0",
      paths: { "/x": { get: { operationId: "x" } } },
    });
    expect(auth).toEqual([]);
  });
});
