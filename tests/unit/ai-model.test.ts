import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  aiConfigured,
  aiModel,
  aiModelId,
  aiProviderStatus,
  DEFAULT_AI_MODEL,
} from "@/lib/ai-model";

const ENV_KEYS = [
  "PAPERVINE_AI_MODEL",
  "PAPERVINE_AI_MODEL_AUTOMATIONS",
  "AI_ROUTING",
  "ANTHROPIC_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "OPENAI_API_KEY",
  "AI_GATEWAY_API_KEY",
  "VERCEL_OIDC_TOKEN",
  "VERCEL",
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

describe("aiModelId", () => {
  it("defaults to the free-tier-validated model and honors PAPERVINE_AI_MODEL", () => {
    expect(aiModelId()).toBe(DEFAULT_AI_MODEL);
    process.env.PAPERVINE_AI_MODEL = "google/gemini-3.1-flash-lite";
    expect(aiModelId()).toBe("google/gemini-3.1-flash-lite");
  });

  it("automations take their own override, falling back to the global model", () => {
    expect(aiModelId("automations")).toBe(DEFAULT_AI_MODEL);
    process.env.PAPERVINE_AI_MODEL_AUTOMATIONS = "anthropic/claude-sonnet-4.6";
    expect(aiModelId("automations")).toBe("anthropic/claude-sonnet-4.6");
    // Other surfaces are unaffected by the automations override.
    expect(aiModelId()).toBe(DEFAULT_AI_MODEL);
    expect(aiModelId("assistant")).toBe(DEFAULT_AI_MODEL);
  });
});

describe("aiModel routing", () => {
  it("gateway routing (the default) resolves any provider-prefixed id", () => {
    expect(() => aiModel("anthropic/claude-haiku-4-5")).not.toThrow();
    expect(() => aiModel("google/gemini-3.1-flash-lite")).not.toThrow();
  });

  it("direct routing resolves supported providers and rejects unknown ones", () => {
    process.env.AI_ROUTING = "direct";
    expect(() => aiModel("anthropic/claude-haiku-4-5")).not.toThrow();
    expect(() => aiModel("mistral/mistral-large")).toThrow(/no direct SDK/);
  });
});

describe("aiProviderStatus", () => {
  it("gateway route accepts AI_GATEWAY_API_KEY, VERCEL_OIDC_TOKEN, or Vercel itself", () => {
    const missing = aiProviderStatus();
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toContain("AI Gateway");

    process.env.AI_GATEWAY_API_KEY = "vck-test";
    expect(aiProviderStatus().ok).toBe(true);

    delete process.env.AI_GATEWAY_API_KEY;
    process.env.VERCEL_OIDC_TOKEN = "eyJ-test";
    expect(aiProviderStatus().ok).toBe(true);

    delete process.env.VERCEL_OIDC_TOKEN;
    process.env.VERCEL = "1";
    expect(aiProviderStatus().ok).toBe(true);
  });

  it("direct route requires the key matching the model's provider prefix", () => {
    process.env.AI_ROUTING = "direct";
    const missing = aiProviderStatus("anthropic/claude-haiku-4-5");
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toContain("ANTHROPIC_API_KEY");

    process.env.ANTHROPIC_API_KEY = "sk-test";
    expect(aiProviderStatus("anthropic/claude-haiku-4-5").ok).toBe(true);
    // Wrong provider's key doesn't satisfy a google model.
    const google = aiProviderStatus("google/gemini-3.1-flash-lite");
    expect(google.ok).toBe(false);
    if (!google.ok) expect(google.error).toContain("GOOGLE_GENERATIVE_AI_API_KEY");
  });

  it("direct route with an unsupported provider reports it instead of throwing", () => {
    process.env.AI_ROUTING = "direct";
    const status = aiProviderStatus("mistral/mistral-large");
    expect(status.ok).toBe(false);
    if (!status.ok) expect(status.error).toContain("no direct SDK");
  });

  it("aiConfigured mirrors the status", () => {
    expect(aiConfigured()).toBe(false);
    process.env.AI_GATEWAY_API_KEY = "vck-test";
    expect(aiConfigured()).toBe(true);
  });
});
