"use client";

import { useState } from "react";
import { Button, ButtonLink } from "@/components/platform/Button";

type State = "invalid" | "signed-out" | "ready";

/**
 * What an OAuth scope actually lets the client do, in a sentence the person approving can act
 * on. The raw names (`offline_access`) tell them nothing, and "approve this to continue" with an
 * opaque list is how consent screens become a rubber stamp.
 */
const SCOPE_COPY: Record<string, string> = {
  openid: "See who you are",
  profile: "See your name",
  email: "See your email address",
  offline_access: "Stay connected without asking you again",
};

export function ConsentForm({
  state,
  consentCode = "",
  clientName = "",
  scopes = [],
  account = "",
}: {
  state: State;
  consentCode?: string;
  clientName?: string;
  scopes?: string[];
  account?: string;
}) {
  const [pending, setPending] = useState<"accept" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(accept: boolean) {
    setPending(accept ? "accept" : "deny");
    setError(null);
    try {
      const res = await fetch("/api/auth/oauth2/consent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ accept, consent_code: consentCode }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.redirectURI) {
        setPending(null);
        setError("Couldn’t complete this request. Try connecting again from your editor.");
        return;
      }
      // The redirect target is the client's own callback — often `http://127.0.0.1:<port>` for a
      // desktop editor — so a hard navigation, not a router push.
      window.location.assign(data.redirectURI);
    } catch {
      setPending(null);
      setError("Couldn’t reach the server. Check your connection and try again.");
    }
  }

  if (state === "signed-out") {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Sign in to continue</h1>
        <p className="text-sm text-[var(--muted)]">
          An application is asking for access to your docs. Sign in first, then approve or deny
          the request.
        </p>
        <ButtonLink href="/login" full>
          Go to sign in
        </ButtonLink>
      </div>
    );
  }

  if (state === "invalid") {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Request no longer valid</h1>
        <p className="text-sm text-[var(--muted)]">
          This authorization request has expired or was already used. Start the connection again
          from your editor.
        </p>
        <ButtonLink href="/" full>
          Go to your dashboard
        </ButtonLink>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">Authorize {clientName}?</h1>
        <p className="text-sm text-[var(--muted)]">
          It will be able to <strong>read and edit the documentation</strong> of sites you can
          edit, on your behalf. Edits go to a draft branch and still need publishing.
        </p>
      </div>

      {/* The name is supplied by whoever registered the client, so say so rather than presenting
          it as verified. Someone who didn't start this flow should be able to tell. */}
      <p className="text-xs text-[var(--muted)]">
        The name above is provided by the application itself. If you didn’t just try to connect an
        editor, deny this request.
      </p>

      <ul className="space-y-1.5 text-sm">
        {scopes.map((scope) => (
          <li key={scope} className="flex gap-2">
            <span aria-hidden="true">•</span>
            <span>{SCOPE_COPY[scope] ?? scope}</span>
          </li>
        ))}
      </ul>

      <p className="text-sm text-[var(--muted)]">
        Signed in as <strong>{account}</strong>
      </p>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex gap-3">
        <Button onClick={() => decide(true)} disabled={pending !== null} full>
          {pending === "accept" ? "Authorizing…" : "Authorize"}
        </Button>
        <Button
          onClick={() => decide(false)}
          disabled={pending !== null}
          variant="ghost"
          full
        >
          {pending === "deny" ? "Denying…" : "Deny"}
        </Button>
      </div>
    </div>
  );
}
