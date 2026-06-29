// Validation for the editable site display name (Settings → General). Pure + DB-free so the
// General action stays a thin wrapper and the rules are unit-tested. The name is the label
// shown across the dashboard (site switcher, breadcrumbs) — it is NOT the slug (the stable URL
// id) and is not the rendered docs title (that comes from the repo's docs.json). SPEC §10.

export const SITE_NAME_MAX = 100;

/**
 * Normalize + validate a submitted display name: trim surrounding whitespace, require something
 * left, and cap the length. Returns the cleaned name or a friendly error — never throws.
 */
export function normalizeSiteName(raw: string): { name: string } | { error: string } {
  const name = (raw ?? "").trim();
  if (name.length === 0) return { error: "Name can’t be empty." };
  if (name.length > SITE_NAME_MAX) {
    return { error: `Name must be ${SITE_NAME_MAX} characters or fewer.` };
  }
  return { name };
}
