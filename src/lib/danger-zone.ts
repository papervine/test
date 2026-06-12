// Pure helpers for the Settings → Danger zone surface (SPEC §10.5). Kept out of the
// "use server" actions file because a "use server" module may only export async actions
// — these sync helpers are shared by the client form and unit-tested in isolation
// (tests/unit/danger-zone.test.ts).

// What's being destroyed. A "site" is one docs deployment (the incumbent's "deployment"); an
// "organization" is the whole workspace — every site, member, and row under it.
export type DangerScope = "site" | "organization";

// A deletion is gated twice: a non-empty reason (the exit-survey we persist), and a
// type-to-confirm of the resource's exact name (the GitHub/Vercel guard against a
// fat-fingered, irreversible click). Both must pass before the action runs.
export function isReasonValid(reason: string): boolean {
  return reason.trim().length > 0;
}

// The typed confirmation must match the resource name exactly (after trimming). Names are
// org/site slugs-or-display-names shown verbatim next to the input, so an exact match is
// the right bar — case-sensitive, like GitHub's "type the repository name".
export function confirmationMatches(typed: string, name: string): boolean {
  return typed.trim() === name.trim();
}

// Both gates at once — the button is armed only when this is true.
export function canDelete(reason: string, typed: string, name: string): boolean {
  return isReasonValid(reason) && confirmationMatches(typed, name);
}
