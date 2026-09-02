/**
 * The `autumn-js` SDK camelCases every response key (`planId`, `trialEndsAt`,
 * `variantDetails.basePlanId`), while Autumn's REST API, its webhooks, its MCP server and
 * its documentation all speak snake_case (`plan_id`, `trial_ends_at`,
 * `variant_details.base_plan_id`). This repo reads the documented shape — the adapter's
 * types, the summary, the admin page, and the captured fixtures — so every SDK response is
 * normalised back to it, once, at the boundary in `autumn.ts`.
 *
 * Why normalise rather than read camelCase: the documented spelling is the one every
 * fixture and every non-SDK source (a webhook body, a response pasted from the dashboard)
 * arrives in, so it is the shape the tests can be written against without a translation
 * step of their own. And the failure this guards against is silent: a snake_case read of a
 * camelCase payload is `undefined`, which reads as "no trial", "no overage", "not an
 * add-on" — never an error.
 *
 * Pure. Converts plain objects and arrays, recursively; leaves everything else (numbers,
 * strings, null, Dates) alone. A key with no upper-case letter is unchanged, so feature ids
 * used AS keys (`ai_credits`, `analytics_retention_days`) survive untouched. Only
 * `metadata` values are exempt, since those keys are the customer's own.
 */
export function snakeCaseKeys<T = unknown>(value: unknown): T {
  return walk(value, false) as T;
}

function walk(value: unknown, verbatim: boolean): unknown {
  if (Array.isArray(value)) return value.map((v) => walk(v, verbatim));
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    const k = verbatim ? key : snakeKey(key);
    out[k] = walk(v, verbatim || k === "metadata");
  }
  return out;
}

function snakeKey(key: string): string {
  // `planId` → `plan_id`, `trialEndsAt` → `trial_ends_at`, `baseVariantId` → `base_variant_id`.
  // Already-snake keys have no upper-case run and fall through unchanged.
  return key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
