"use client";

import { useState } from "react";
import Link from "next/link";
import { authClient, signOut } from "@/lib/auth-client";
import { Button, ButtonLink } from "@/components/platform/Button";

type State = "invalid" | "anon" | "ready" | "mismatch";

export function AcceptInvite({
  state,
  id = "",
  inviteEmail = "",
  orgName = "",
  sessionEmail = null,
}: {
  state: State;
  id?: string;
  inviteEmail?: string;
  orgName?: string;
  sessionEmail?: string | null;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setPending(true);
    setError(null);
    const { error } = await authClient.organization.acceptInvitation({ invitationId: id });
    if (error) {
      setPending(false);
      setError(error.message ?? "Couldn’t accept this invitation.");
      return;
    }
    // Hard nav to the app-host root resolver → forwards to the org's first site. A soft push
    // would skip the app-host Host rewrite.
    window.location.assign("/");
  }

  if (state === "invalid") {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Invitation not found</h1>
        <p className="text-sm text-[var(--muted)]">
          This invitation is no longer valid — it may have been revoked, already accepted, or
          expired. Ask whoever invited you to send a new one.
        </p>
        <ButtonLink href="/login" full>
          Go to sign in
        </ButtonLink>
      </div>
    );
  }

  const inviteParams = `invite=${encodeURIComponent(id)}&email=${encodeURIComponent(inviteEmail)}`;

  if (state === "anon") {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Join {orgName}</h1>
        <p className="text-sm text-[var(--muted)]">
          You’ve been invited to join <span className="text-[var(--fg)]">{orgName}</span> on
          Papervine as <span className="text-[var(--fg)]">{inviteEmail}</span>. Create an account
          or sign in with that email to accept.
        </p>
        <ButtonLink href={`/signup?${inviteParams}`} full>
          Sign up &amp; accept
        </ButtonLink>
        <p className="text-center text-sm text-[var(--muted)]">
          Already have an account?{" "}
          <Link href={`/login?${inviteParams}`} className="text-[var(--blue)] hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    );
  }

  if (state === "mismatch") {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Wrong account</h1>
        <p className="text-sm text-[var(--muted)]">
          This invitation is for <span className="text-[var(--fg)]">{inviteEmail}</span>, but
          you’re signed in as <span className="text-[var(--fg)]">{sessionEmail}</span>. Sign out
          and sign back in with the invited email to accept.
        </p>
        <Button
          full
          disabled={pending}
          onClick={async () => {
            setPending(true);
            await signOut();
            window.location.assign(`/login?${inviteParams}`);
          }}
        >
          {pending ? "Signing out…" : "Sign out"}
        </Button>
      </div>
    );
  }

  // state === "ready"
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Join {orgName}</h1>
      <p className="text-sm text-[var(--muted)]">
        You’ve been invited to join <span className="text-[var(--fg)]">{orgName}</span> on
        Papervine. Accept to get access.
      </p>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <Button full disabled={pending} onClick={accept}>
        {pending ? "Accepting…" : `Accept invitation`}
      </Button>
    </div>
  );
}
