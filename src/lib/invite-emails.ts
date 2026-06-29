// Parsing for the "Invite member" textarea, where an admin pastes one or more addresses
// "separated by commas or spaces" (and, in practice, newlines/semicolons too). Pure + DB-free
// so it's unit-tested without a browser or Better Auth; the server action (settings/members)
// just feeds it the raw textarea value and invites each returned address. SPEC §10.

// Deliberately lenient — this gates "is this worth attempting an invite for", not RFC-5322
// conformance (Better Auth does the authoritative check at createInvitation). One @, a dot in
// the domain, no whitespace.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Cap a single submission so a pasted mailing list can't fan out into hundreds of invites
// (Better Auth also enforces a per-org invitationLimit). Extras are reported as `truncated`.
export const MAX_INVITES_PER_SUBMIT = 50;

export type ParsedInviteEmails = {
  /** Valid, normalized (trimmed + lowercased), de-duplicated addresses, capped at the max. */
  emails: string[];
  /** Tokens that looked like an attempt but failed validation — surfaced back to the user. */
  invalid: string[];
  /** True when valid addresses were dropped to honor MAX_INVITES_PER_SUBMIT. */
  truncated: boolean;
};

/** Split a raw textarea value into validated, de-duplicated invite addresses. */
export function parseInviteEmails(raw: string): ParsedInviteEmails {
  const tokens = (raw ?? "")
    .split(/[\s,;]+/) // commas, spaces, tabs, newlines, semicolons
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  const emails: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    if (!EMAIL_RE.test(token)) {
      if (!invalid.includes(token)) invalid.push(token);
      continue;
    }
    if (seen.has(token)) continue;
    seen.add(token);
    emails.push(token);
  }

  const truncated = emails.length > MAX_INVITES_PER_SUBMIT;
  return { emails: emails.slice(0, MAX_INVITES_PER_SUBMIT), invalid, truncated };
}
