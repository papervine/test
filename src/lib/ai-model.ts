import { gateway } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

// The single place the AI model is chosen for every server-side AI call (public
// assistant, editor agent). Everything is env-configurable — we are NOT hardcoded to any
// one provider or to the Vercel AI Gateway.
//
//   PAPERVINE_AI_MODEL   "provider/model" id, e.g. "anthropic/claude-haiku-4-5",
//                        "google/gemini-3.1-flash-lite", "openai/gpt-5-nano".
//
//   AI_ROUTING           "gateway" (default) → route through the Vercel AI Gateway (one
//                        key/OIDC, unified access to every provider + model).
//                        "direct"  → call the provider's own SDK directly with THAT
//                        provider's key (no Vercel in the middle) — full flexibility /
//                        no lock-in. Supported direct providers: anthropic, google, openai.
//
// This keeps the `ai` SDK's ergonomics while letting you use the gateway when convenient
// and go direct when you'd rather (own keys, other billing, avoiding gateway limits).
export const AI_MODEL_ID =
  process.env.PAPERVINE_AI_MODEL ?? "anthropic/claude-haiku-4-5";

const ROUTING = process.env.AI_ROUTING === "direct" ? "direct" : "gateway";

// provider prefix → its direct SDK factory. Each reads its own key from the env
// (ANTHROPIC_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY / OPENAI_API_KEY).
const DIRECT: Record<string, (model: string) => LanguageModel> = {
  anthropic: (m) => anthropic(m),
  google: (m) => google(m),
  openai: (m) => openai(m),
};

function splitModel(id: string): { provider: string; model: string } {
  const i = id.indexOf("/");
  return i === -1
    ? { provider: "", model: id }
    : { provider: id.slice(0, i), model: id.slice(i + 1) };
}

/** The resolved model for streamText/generateText — gateway or direct per AI_ROUTING. */
export function aiModel(): LanguageModel {
  if (ROUTING === "direct") {
    const { provider, model } = splitModel(AI_MODEL_ID);
    const make = DIRECT[provider];
    if (!make)
      throw new Error(
        `AI_ROUTING=direct but no direct SDK for provider '${provider}' ` +
          `(PAPERVINE_AI_MODEL=${AI_MODEL_ID}). Supported: ${Object.keys(DIRECT).join(", ")}, or use AI_ROUTING=gateway.`,
      );
    return make(model);
  }
  // Gateway: pass the full "provider/model" string through the Vercel AI Gateway.
  return gateway(AI_MODEL_ID);
}

/** AI is usable when the chosen route can authenticate. Routes return 503 when false, so
 *  no-key envs (smoke/CI) degrade cleanly. */
export function aiConfigured(): boolean {
  if (ROUTING === "direct") {
    const { provider } = splitModel(AI_MODEL_ID);
    if (provider === "anthropic") return Boolean(process.env.ANTHROPIC_API_KEY);
    if (provider === "google") return Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY);
    if (provider === "openai") return Boolean(process.env.OPENAI_API_KEY);
    return false;
  }
  // Gateway: a key in dev, or Vercel OIDC in prod.
  return Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL);
}
