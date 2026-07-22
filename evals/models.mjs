// The default model shortlist for the automation evals. Slugs are Vercel AI Gateway ids;
// `in`/`out` are USD per 1M tokens (used only to estimate per-run cost in the report).
//
// Refresh prices/slugs any time:
//   curl -s https://ai-gateway.vercel.sh/v1/models | node -e '...'
// (a fuller price table lives in _private/vercel-gateway-models.md).
//
// Override on the CLI: `npm run eval -- --models=deepseek/deepseek-v4-flash,anthropic/claude-haiku-4.5`
export const MODELS = [
  { slug: "deepseek/deepseek-v4-flash", in: 0.14, out: 0.28 },
  { slug: "google/gemini-2.5-flash-lite", in: 0.1, out: 0.4 },
  { slug: "anthropic/claude-haiku-4.5", in: 1.0, out: 5.0 },
];

// Look up a price row for a slug the CLI passed that isn't in the shortlist (cost shows as
// unknown rather than failing — the accuracy numbers are the point, cost is secondary).
export function priceFor(slug) {
  return MODELS.find((m) => m.slug === slug) ?? { slug, in: null, out: null };
}
