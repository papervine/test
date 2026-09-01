/**
 * User-code handling for the device authorization flow (SPEC §11.4).
 *
 * Pure string work, kept out of the page so `tests/unit/device-code.test.ts` can pin it without
 * a browser or a database. Both directions matter and both have bitten this kind of flow before:
 *
 *  - **Normalizing before lookup.** Better Auth stores the code as generated — uppercase, no
 *    separator — and its own lookup only strips `-`. It does NOT upper-case. So a human who
 *    types `abcd-1234` (or whose phone keyboard did) gets "invalid code" for a code that is
 *    sitting right there in the table. Everything that reaches the API goes through here first.
 *  - **Formatting for display.** The code is read off a terminal and typed into a browser, so it
 *    is shown grouped. The group separator is cosmetic and never stored.
 *
 * The generator's alphabet already excludes `0`/`O`/`1`/`I`, so there is no ambiguity to unfold
 * here — we deliberately do NOT map look-alikes, because mapping `0`→`O` on an alphabet that
 * contains neither would only mask a genuinely wrong code.
 */

/** Strip separators and whitespace, upper-case. What every lookup and mutation must use. */
export function normalizeUserCode(input: string | null | undefined): string {
  return String(input ?? "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
}

/** `ABCD1234` → `ABCD-1234`, for the one place a human reads it back. Cosmetic only. */
export function formatUserCode(code: string | null | undefined): string {
  const clean = normalizeUserCode(code);
  if (clean.length < 6 || clean.length > 12) return clean;
  const mid = Math.ceil(clean.length / 2);
  return `${clean.slice(0, mid)}-${clean.slice(mid)}`;
}

/** Is this even plausibly a code? Cheap guard so a stray `?user_code=` doesn't hit the DB. */
export function isPlausibleUserCode(code: string | null | undefined): boolean {
  const clean = normalizeUserCode(code);
  return clean.length >= 6 && clean.length <= 12;
}
