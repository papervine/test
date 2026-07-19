// AI model/provider resolution (SPEC §18): every Claude surface (assistant, editor
// agent, automation runs) resolves its model here, and one env var expresses both the
// model AND the route:
//
//   PAPERVINE_AI_MODEL=claude-sonnet-4-6              → direct Anthropic API
//   PAPERVINE_AI_MODEL=anthropic/claude-sonnet-4.6    → Vercel AI Gateway
//
// A provider-prefixed id (anything with a "/") is passed to the AI SDK as a string,
// which routes through the SDK's global provider — the Vercel AI Gateway —
// authenticated by AI_GATEWAY_API_KEY or, on Vercel/locally via `vercel env pull`,
// VERCEL_OIDC_TOKEN. A bare id goes straight to @ai-sdk/anthropic. Swapping routes is
// an env change, no deploy — the §18 no-lock-in escape hatch in both directions.
import { anthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

export const DEFAULT_AI_MODEL = "claude-sonnet-4-6";

export function aiModelId(): string {
  return process.env.PAPERVINE_AI_MODEL?.trim() || DEFAULT_AI_MODEL;
}

export function isGatewayModelId(id: string): boolean {
  return id.includes("/");
}

// The value handed to generateText/streamText.
export function aiModel(id: string = aiModelId()): LanguageModel {
  return isGatewayModelId(id) ? id : anthropic(id);
}

// Whether the configured route has a credential — the automation task fails fast with
// this instead of a mid-run API error. (The AI SDK checks the same envs; this only
// mirrors them for a friendly precheck, so keep the two lists in sync.)
export function aiProviderStatus(id: string = aiModelId()):
  | { ok: true }
  | { ok: false; error: string } {
  if (isGatewayModelId(id)) {
    return process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN
      ? { ok: true }
      : {
          ok: false,
          error: `model "${id}" routes via the AI Gateway but neither AI_GATEWAY_API_KEY nor VERCEL_OIDC_TOKEN is set`,
        };
  }
  return process.env.ANTHROPIC_API_KEY
    ? { ok: true }
    : { ok: false, error: "ANTHROPIC_API_KEY is not configured" };
}
