import { gateway } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

// The single place the AI model is chosen for every server-side AI call (public
// assistant, editor agent, automation runs). Everything is env-configurable — we are
// NOT hardcoded to any one provider or to the Vercel AI Gateway (SPEC §18).
//
//   PAPERVINE_AI_MODEL   "provider/model" id, e.g. "anthropic/claude-haiku-4-5",
//                        "google/gemini-3.1-flash-lite", "openai/gpt-5-nano".
//
//   PAPERVINE_AI_MODEL_AUTOMATIONS
//                        Optional override for automation runs. The global default is
//                        tuned for the high-volume assistant; automations *write docs*
//                        that land in Git, where a stronger writer earns its credits.
//
//   AI_ROUTING           "gateway" (default) → route through the Vercel AI Gateway (one
//                        key/OIDC, unified access to every provider + model).
//                        "direct"  → call the provider's own SDK directly with THAT
//                        provider's key (no Vercel in the middle) — full flexibility /
//                        no lock-in. Supported direct providers: anthropic, google, openai.
//
// This keeps the `ai` SDK's ergonomics while letting you use the gateway when convenient
// and go direct when you'd rather (own keys, other billing, avoiding gateway limits).
// Env is read per call, not at module load, so long-lived dev servers and unit tests
// see changes without a module-cache reset (the collab-secret lesson).

// Best model the gateway FREE tier reliably runs for our use case (see .env.example
// for the cheaper paid/BYOK alternatives).
export const DEFAULT_AI_MODEL = "anthropic/claude-haiku-4-5";

export type AiSurface = "assistant" | "editor" | "automations";

export function aiModelId(surface?: AiSurface): string {
  if (surface === "automations") {
    const override = process.env.PAPERVINE_AI_MODEL_AUTOMATIONS?.trim();
    if (override) return override;
  }
  return process.env.PAPERVINE_AI_MODEL?.trim() || DEFAULT_AI_MODEL;
}

function routing(): "gateway" | "direct" {
  return process.env.AI_ROUTING === "direct" ? "direct" : "gateway";
}

// provider prefix → its direct SDK factory + the env var holding its key.
const DIRECT: Record<string, { make: (model: string) => LanguageModel; keyVar: string }> = {
  anthropic: { make: (m) => anthropic(m), keyVar: "ANTHROPIC_API_KEY" },
  google: { make: (m) => google(m), keyVar: "GOOGLE_GENERATIVE_AI_API_KEY" },
  openai: { make: (m) => openai(m), keyVar: "OPENAI_API_KEY" },
};

function splitModel(id: string): { provider: string; model: string } {
  const i = id.indexOf("/");
  return i === -1
    ? { provider: "", model: id }
    : { provider: id.slice(0, i), model: id.slice(i + 1) };
}

/** The resolved model for streamText/generateText — gateway or direct per AI_ROUTING. */
export function aiModel(id: string = aiModelId()): LanguageModel {
  if (routing() === "direct") {
    const { provider, model } = splitModel(id);
    const direct = DIRECT[provider];
    if (!direct)
      throw new Error(
        `AI_ROUTING=direct but no direct SDK for provider '${provider}' ` +
          `(model=${id}). Supported: ${Object.keys(DIRECT).join(", ")}, or use AI_ROUTING=gateway.`,
      );
    return direct.make(model);
  }
  // Gateway: pass the full "provider/model" string through the Vercel AI Gateway.
  return gateway(id);
}

/** Whether the chosen route can authenticate, with the reason when it can't — the
 *  automation task fails fast on this instead of a mid-run API error; HTTP routes 503
 *  so no-key envs (smoke/CI) degrade cleanly. */
export function aiProviderStatus(id: string = aiModelId()):
  | { ok: true }
  | { ok: false; error: string } {
  if (routing() === "direct") {
    const { provider } = splitModel(id);
    const direct = DIRECT[provider];
    if (!direct) {
      return {
        ok: false,
        error: `AI_ROUTING=direct but no direct SDK for provider '${provider}' (model=${id})`,
      };
    }
    return process.env[direct.keyVar]
      ? { ok: true }
      : { ok: false, error: `${direct.keyVar} is not configured (AI_ROUTING=direct, model=${id})` };
  }
  // Gateway: a key (dev/workers), a pulled OIDC token (local), or Vercel itself (OIDC).
  return process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL
    ? { ok: true }
    : {
        ok: false,
        error: `model "${id}" routes via the AI Gateway but neither AI_GATEWAY_API_KEY nor VERCEL_OIDC_TOKEN is set`,
      };
}

/** Boolean form of aiProviderStatus for call sites that only gate. */
export function aiConfigured(): boolean {
  return aiProviderStatus().ok;
}
