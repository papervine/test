/**
 * The waitlist's pure core: what counts as a submission, and what gets stored.
 *
 * Kept free of `server-only` and of any DB import so it can be unit-tested directly and shared
 * by the route handler and the form. Everything effectful (rate limiting, the insert) lives in
 * `src/app/api/waitlist/route.ts`.
 */

/** Long enough for a real answer, short enough that the column can't be used as storage. */
export const WAITLIST_NOTE_MAX = 500;
/** Nobody's address is this long, and the check runs before any DB work. */
export const WAITLIST_EMAIL_MAX = 254;

export type WaitlistEntryInput = {
  email: string;
  note: string | null;
  source: string | null;
};

export type WaitlistParse =
  | { ok: true; value: WaitlistEntryInput }
  | { ok: false; error: string };

/**
 * Lowercased and trimmed, because the column is unique and `Jeff@x.com` re-signing up as
 * `jeff@x.com` should be the same person rather than a duplicate row.
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Deliberately permissive. This is a waitlist, not an auth boundary — a real address that a
 * stricter pattern rejects is a lost signup, while a fake one that gets through costs a row.
 * The only real job is catching a typo'd or empty field before it reaches the database.
 */
export function isEmailish(email: string): boolean {
  return email.length <= WAITLIST_EMAIL_MAX && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Empty strings become null, so "left blank" and "sent nothing" are one state in the column. */
function tidy(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().slice(0, max);
  return value === "" ? null : value;
}

/**
 * Validate a submitted body. Returns a message meant to be shown to the person who typed it,
 * so it says what to do rather than what failed.
 */
export function parseWaitlistSubmission(body: unknown): WaitlistParse {
  const raw = (body ?? {}) as Record<string, unknown>;
  const email = normalizeEmail(typeof raw.email === "string" ? raw.email : "");

  if (email === "") return { ok: false, error: "Enter your email address." };
  if (!isEmailish(email)) return { ok: false, error: "That doesn't look like an email address." };

  return {
    ok: true,
    value: {
      email,
      note: tidy(raw.note, WAITLIST_NOTE_MAX),
      // Where they came from, captured from the page rather than typed. Bounded like everything
      // else that arrives from a browser.
      source: tidy(raw.source, 300),
    },
  };
}

/**
 * A hidden field real people never fill in. Bots fill every input they find, so a non-empty
 * value means "drop it" — and the caller answers with SUCCESS anyway, because telling a bot it
 * was caught is how it learns to stop filling the field.
 */
export function isHoneypotTripped(body: unknown): boolean {
  const raw = (body ?? {}) as Record<string, unknown>;
  return typeof raw.company === "string" && raw.company.trim() !== "";
}
