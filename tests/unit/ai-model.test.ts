import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { aiModel, aiModelId, aiProviderStatus, isGatewayModelId } from "@/lib/ai-model";

const ENV_KEYS = [
  "PAPERVINE_AI_MODEL",
  "ANTHROPIC_API_KEY",
  "AI_GATEWAY_API_KEY",
  "VERCEL_OIDC_TOKEN",
] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("ai model resolution", () => {
  it("defaults to the direct model id and honors PAPERVINE_AI_MODEL", () => {
    expect(aiModelId()).toBe("claude-sonnet-4-6");
    process.env.PAPERVINE_AI_MODEL = "anthropic/claude-sonnet-4.6";
    expect(aiModelId()).toBe("anthropic/claude-sonnet-4.6");
  });

  it("a provider-prefixed id routes via the gateway (string model)", () => {
    expect(isGatewayModelId("anthropic/claude-sonnet-4.6")).toBe(true);
    expect(isGatewayModelId("claude-sonnet-4-6")).toBe(false);
    // Gateway ids pass through as strings (the AI SDK's global-provider routing);
    // bare ids become a provider-bound model object.
    expect(aiModel("anthropic/claude-sonnet-4.6")).toBe("anthropic/claude-sonnet-4.6");
    expect(typeof aiModel("claude-sonnet-4-6")).toBe("object");
  });
});

describe("aiProviderStatus", () => {
  it("direct route requires ANTHROPIC_API_KEY", () => {
    process.env.PAPERVINE_AI_MODEL = "claude-sonnet-4-6";
    expect(aiProviderStatus().ok).toBe(false);
    process.env.ANTHROPIC_API_KEY = "sk-test";
    expect(aiProviderStatus().ok).toBe(true);
  });

  it("gateway route accepts either AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN", () => {
    process.env.PAPERVINE_AI_MODEL = "anthropic/claude-sonnet-4.6";
    const missing = aiProviderStatus();
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toContain("AI Gateway");

    process.env.AI_GATEWAY_API_KEY = "vck-test";
    expect(aiProviderStatus().ok).toBe(true);

    delete process.env.AI_GATEWAY_API_KEY;
    process.env.VERCEL_OIDC_TOKEN = "eyJ-test";
    expect(aiProviderStatus().ok).toBe(true);
  });

  it("gateway route does not require the direct key (the bug this replaces)", () => {
    process.env.PAPERVINE_AI_MODEL = "anthropic/claude-sonnet-4.6";
    process.env.AI_GATEWAY_API_KEY = "vck-test";
    // No ANTHROPIC_API_KEY at all — still fine.
    expect(aiProviderStatus().ok).toBe(true);
  });
});
