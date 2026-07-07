// Pure role rules for the Members surface (SPEC §10) — who may assign which org role.
// Mirrors Better Auth's organization-plugin enforcement so the UI offers exactly what the
// server will accept (the server still re-checks): only the creator role (owner) may
// grant `owner` — on an invitation OR a role change — and only an owner may edit an
// existing owner. Kept sync + DB-free so the client form shares it and it's unit-tested
// in isolation (tests/unit/org-roles.test.ts), same split as danger-zone/transfer-site.

export const ORG_ROLES = ["member", "admin", "owner"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export function isOrgRole(value: string): value is OrgRole {
  return (ORG_ROLES as readonly string[]).includes(value);
}

// The roles an actor may hand out (to an invitee or an existing member).
export function assignableRoles(actorRole: string | null | undefined): OrgRole[] {
  if (actorRole === "owner") return ["member", "admin", "owner"];
  if (actorRole === "admin") return ["member", "admin"];
  return [];
}

// Whether the actor may change THIS member's role at all: managers only, never yourself
// (Better Auth also rejects demoting the last owner — surfaced as an error, not predicted
// here), and an existing owner's role is only an owner's to touch.
export function canEditMemberRole(
  actorRole: string | null | undefined,
  target: { role: string; isSelf: boolean },
): boolean {
  if (target.isSelf) return false;
  if (assignableRoles(actorRole).length === 0) return false;
  if (target.role === "owner" && actorRole !== "owner") return false;
  return true;
}
