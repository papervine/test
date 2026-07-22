// The default model shortlist for the automation evals. Slugs are Vercel AI Gateway ids;
// `in`/`out` are USD per 1M tokens (used only to estimate per-run cost in the report).
//
// Refresh prices/slugs any time:
//   curl -s https://ai-gateway.vercel.sh/v1/models | node -e '...'
// (a fuller price table lives in _private/vercel-gateway-models.md).
//
// Override on the CLI: `npm run eval -- --models=deepseek/deepseek-v4-flash,anthropic/claude-haiku-4.5`
//
// A curated default set — cheap/fast tool-capable models across providers, spanning the
// cost/quality frontier, plus one premium reference (Haiku). Any Vercel Gateway slug works
// via --models even if it's not listed here (cost then shows n/a unless added below). Keep
// this lean: every entry runs on a bare `npm run eval`. Prices $ per 1M (input/output).
export const MODELS = [
  { slug: "openai/gpt-5-nano", in: 0.05, out: 0.4 }, // cheapest OpenAI tool model
  { slug: "mistral/mistral-small", in: 0.1, out: 0.3 }, // EU provider — governance alt to DeepSeek
  { slug: "google/gemini-2.5-flash-lite", in: 0.1, out: 0.4 },
  { slug: "deepseek/deepseek-v4-flash", in: 0.14, out: 0.28 },
  { slug: "openai/gpt-4o-mini", in: 0.15, out: 0.6 }, // reliable Western baseline
  { slug: "deepseek/deepseek-v4-pro", in: 0.43, out: 0.87 }, // does "pro" beat "flash"?
  { slug: "google/gemini-3-flash", in: 0.5, out: 3.0 }, // does the 3-series fix flash-lite over-editing?
  { slug: "anthropic/claude-haiku-4.5", in: 1.0, out: 5.0 }, // premium quality reference
];

// Look up a price row for a slug the CLI passed that isn't in the shortlist (cost shows as
// unknown rather than failing — the accuracy numbers are the point, cost is secondary).
export function priceFor(slug) {
  return MODELS.find((m) => m.slug === slug) ?? { slug, in: null, out: null };
}
