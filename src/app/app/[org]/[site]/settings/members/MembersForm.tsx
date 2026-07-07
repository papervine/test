"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Copy, Check, Mail } from "lucide-react";
import { Select } from "@/components/ui/select";
import {
  assignableRoles,
  canEditMemberRole,
  isOrgRole,
  type OrgRole,
} from "@/lib/org-roles";
import {
  inviteMembers,
  cancelInvite,
  removeMember,
  changeMemberRole,
  type SiteRef,
  type InviteOutcome,
} from "./actions";

export type MemberRow = {
  id: string;
  email: string;
  role: string;
  joinedAt: string; // ISO
  isSelf: boolean;
};

export type InviteRow = {
  id: string;
  email: string;
  role: string;
  expiresAt: string; // ISO
};

function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// Per-email invite outcome → friendly line.
const OUTCOME_LABEL: Record<InviteOutcome["status"], string> = {
  sent: "Invited",
  "already-member": "Already a member",
  "already-invited": "Already invited",
  error: "Couldn’t invite",
};

export function MembersForm({
  siteRef,
  members,
  invites,
  canManage,
  viewerRole,
}: {
  siteRef: SiteRef;
  members: MemberRow[];
  invites: InviteRow[];
  canManage: boolean;
  viewerRole: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [emails, setEmails] = useState("");
  const [inviteRole, setInviteRole] = useState<OrgRole>("member");
  const [results, setResults] = useState<InviteOutcome[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // What this viewer may hand out — owners can grant owner, admins stop at admin
  // (Better Auth rejects anything beyond this server-side; the picker just doesn't offer it).
  const grantable = assignableRoles(viewerRole);

  function run(fn: () => Promise<{ ok?: boolean; error?: string }>, after?: () => void) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res.error) {
        setError(res.error);
        return;
      }
      after?.();
      router.refresh();
    });
  }

  function send() {
    setError(null);
    setResults(null);
    start(async () => {
      const res = await inviteMembers(siteRef, emails, inviteRole);
      if (res.error && !res.results) {
        setError(res.error);
        return;
      }
      setResults(res.results ?? []);
      // Keep addresses that errored so the user can retry; clear the ones that went through.
      const failed = new Set(
        (res.results ?? []).filter((r) => r.status === "error").map((r) => r.email),
      );
      setEmails((cur) =>
        cur
          .split(/[\s,;]+/)
          .map((t) => t.trim())
          .filter((t) => failed.has(t.toLowerCase()))
          .join(", "),
      );
      router.refresh();
    });
  }

  async function copyLink(id: string) {
    try {
      await navigator.clipboard.writeText(`${location.origin}/accept-invite?id=${id}`);
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500);
    } catch {
      /* clipboard blocked — no-op */
    }
  }

  return (
    <div className="mt-8 flex flex-col gap-8">
      {/* Invite */}
      {canManage && (
        <section className="db-feature rounded-xl px-5 py-5">
          <h2 className="text-sm font-semibold">Invite member</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Enter email addresses, separated by commas or spaces.
          </p>
          <textarea
            value={emails}
            onChange={(e) => setEmails(e.target.value)}
            placeholder="name@pixwel.com"
            rows={3}
            className="mt-3 w-full resize-y rounded-lg border border-[rgba(var(--ink-rgb),0.08)] bg-transparent px-3 py-2 text-sm outline-none placeholder:text-[var(--muted)]/60 focus:border-[rgba(var(--ink-rgb),0.2)]"
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <div className="w-36">
              <Select
                aria-label="Invite role"
                value={inviteRole}
                onChange={(e) => {
                  if (isOrgRole(e.target.value)) setInviteRole(e.target.value);
                }}
                className="capitalize"
              >
                {grantable.map((r) => (
                  <option key={r} value={r} className="capitalize">
                    {r}
                  </option>
                ))}
              </Select>
            </div>
            <button
              type="button"
              disabled={pending || emails.trim().length === 0}
              onClick={send}
              className="db-cta rounded-lg px-4 py-2 text-sm disabled:opacity-50"
            >
              {pending ? "Sending…" : "Send Invite"}
            </button>
            {error && <span className="text-sm text-red-400">{error}</span>}
          </div>

          {results && results.length > 0 && (
            <ul className="mt-4 flex flex-col gap-1.5 text-sm">
              {results.map((r) => (
                <li key={r.email} className="flex items-center gap-2">
                  <span
                    className={
                      r.status === "sent"
                        ? "text-emerald-400"
                        : r.status === "error"
                          ? "text-red-400"
                          : "text-[var(--muted)]"
                    }
                  >
                    {OUTCOME_LABEL[r.status]}
                  </span>
                  <span className="text-[var(--fg)]">{r.email}</span>
                  {r.message && <span className="text-[var(--muted)]">— {r.message}</span>}
                  {r.status === "sent" && (
                    <button
                      type="button"
                      onClick={() => copyLink(idFromLink(r.link))}
                      className="ml-1 inline-flex items-center gap-1 text-xs text-[var(--muted)] hover:text-[var(--fg)]"
                    >
                      <Copy className="h-3 w-3" /> Copy link
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Active members */}
      <section>
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">
            Active members <span className="text-[var(--muted)]">· {members.length}</span>
          </h2>
        </div>
        <div className="mt-3 overflow-hidden rounded-xl border border-[rgba(var(--ink-rgb),0.06)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[rgba(var(--ink-rgb),0.06)] text-left text-[var(--muted)]">
                <th className="px-4 py-2.5 font-medium">Member</th>
                <th className="px-4 py-2.5 font-medium">Role</th>
                <th className="px-4 py-2.5 font-medium">Joined</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-b border-[rgba(var(--ink-rgb),0.04)] last:border-0">
                  <td className="px-4 py-3">
                    {m.email}
                    {m.isSelf && <span className="ml-2 text-xs text-[var(--muted)]">(you)</span>}
                  </td>
                  <td className="px-4 py-3 text-[var(--muted)]">
                    {canEditMemberRole(viewerRole, m) ? (
                      // Owner/admin can re-role a member in place (this is how an owner
                      // grants `owner`/`admin` — e.g. to make an org an eligible site-transfer
                      // destination). The picker offers what THIS viewer may grant; Better
                      // Auth re-checks and refuses e.g. demoting the last owner.
                      <div className="w-32">
                        <Select
                          aria-label={`Role of ${m.email}`}
                          value={isOrgRole(m.role) ? m.role : "member"}
                          disabled={pending}
                          onChange={(e) => {
                            const next = e.target.value;
                            if (isOrgRole(next) && next !== m.role) {
                              run(() => changeMemberRole(siteRef, m.id, next));
                            }
                          }}
                          className="h-8 capitalize"
                        >
                          {grantable.map((r) => (
                            <option key={r} value={r} className="capitalize">
                              {r}
                            </option>
                          ))}
                        </Select>
                      </div>
                    ) : (
                      <span className="capitalize">{m.role}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[var(--muted)]">{shortDate(m.joinedAt)}</td>
                  <td className="px-4 py-3 text-right">
                    {canManage && !m.isSelf && (
                      <button
                        type="button"
                        aria-label={`Remove ${m.email}`}
                        disabled={pending}
                        onClick={() => run(() => removeMember(siteRef, m.id))}
                        className="rounded-lg border border-[rgba(var(--ink-rgb),0.08)] p-2 text-[var(--muted)] transition-colors hover:text-red-400 disabled:opacity-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Pending invitations */}
      {invites.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold">
            Pending invitations <span className="text-[var(--muted)]">· {invites.length}</span>
          </h2>
          <div className="mt-3 flex flex-col gap-2">
            {invites.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center gap-3 rounded-xl border border-[rgba(var(--ink-rgb),0.06)] px-4 py-3 text-sm"
              >
                <Mail className="h-4 w-4 shrink-0 text-[var(--muted)]" />
                <span>{inv.email}</span>
                <span className="capitalize text-[var(--muted)]">· {inv.role}</span>
                <span className="text-[var(--muted)]">· expires {shortDate(inv.expiresAt)}</span>
                <div className="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => copyLink(inv.id)}
                    className="inline-flex items-center gap-1 rounded-lg border border-[rgba(var(--ink-rgb),0.08)] px-2.5 py-1.5 text-xs text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
                  >
                    {copied === inv.id ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-400" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" /> Copy link
                      </>
                    )}
                  </button>
                  {canManage && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => run(() => cancelInvite(siteRef, inv.id))}
                      className="rounded-lg border border-[rgba(var(--ink-rgb),0.08)] px-2.5 py-1.5 text-xs text-[var(--muted)] transition-colors hover:text-red-400 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// The invite result carries a full accept URL; the copy handler rebuilds from the current
// origin (so it's right whichever host the admin is on), so we only need the id back out.
function idFromLink(link: string | undefined): string {
  if (!link) return "";
  try {
    return new URL(link).searchParams.get("id") ?? "";
  } catch {
    return "";
  }
}
