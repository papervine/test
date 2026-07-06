// Platform superadmin (SPEC §10.10). Papervine has no staff-role column — the operator
// allowlists themselves by email via the PLATFORM_ADMIN_EMAILS env var (comma-separated).
// An env allowlist beats a DB flag here: there's no UI to grant/revoke it (so nothing to
// escalate through), it can't be reached from the signup path, and rotating it is a
// deploy, not a data migration. Pure — usable from client and server, unit-tested in
// tests/unit/platform-admin.test.ts. The server-side gate is requirePlatformAdmin in
// src/lib/dashboard-context.ts.
export function platformAdminEmails(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

// Case-insensitive match against the allowlist. An unset/empty allowlist means NOBODY
// is a platform admin — the surface stays dark until the operator opts in.
export function isPlatformAdminEmail(
  email: string | null | undefined,
  raw: string | null | undefined,
): boolean {
  if (!email) return false;
  return platformAdminEmails(raw).includes(email.trim().toLowerCase());
}

// The Better Auth admin plugin authorizes impersonation by `user.role`, but our source
// of truth is the env allowlist — so the role column is a synced mirror, never edited by
// hand. Returns the role the user's row SHOULD have ("admin"/"user"), or null when it's
// already right (skip the write). Synced at sign-in (grant + revoke — a removed email
// loses plugin access at their next session) and again in the impersonate action (grant
// only, so an allowlist edit works for already-live sessions without re-login).
export function resolvePlatformRole(
  email: string | null | undefined,
  raw: string | null | undefined,
  currentRole: string | null | undefined,
): "admin" | "user" | null {
  const shouldBeAdmin = isPlatformAdminEmail(email, raw);
  if (shouldBeAdmin && currentRole !== "admin") return "admin";
  if (!shouldBeAdmin && currentRole === "admin") return "user";
  return null;
}
