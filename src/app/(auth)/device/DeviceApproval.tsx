"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, ButtonLink } from "@/components/platform/Button";
import { Field } from "@/components/platform/Field";
import { formatUserCode } from "@/lib/device-code";
import { approveDevice, denyDevice } from "./actions";

type State = "prompt" | "anon" | "invalid" | "confirm" | "approved" | "denied";

/**
 * The device-approval card (SPEC §11.4). One component, six states, because they are the same
 * conversation at different points and splitting them would duplicate the code display.
 *
 * The bar this screen has to clear: the device grant's known weakness is that a stranger can
 * start a flow and talk someone into approving it. Everything here exists to make that hard to
 * do accidentally — the requesting client is named, the code is shown so it can be compared
 * against the terminal, granting is an explicit button (never a link), and refusing is offered
 * with equal weight rather than hidden as a cancel.
 */
export function DeviceApproval({
  state,
  code = "",
  clientId = null,
  scope = null,
  email = null,
}: {
  state: State;
  code?: string;
  clientId?: string | null;
  scope?: string | null;
  email?: string | null;
}) {
  const [pending, setPending] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<"approved" | "denied" | null>(null);

  const shown = formatUserCode(code);
  const resume = `/device?user_code=${encodeURIComponent(code)}`;

  async function act(action: "approve" | "deny") {
    setPending(action);
    setError(null);
    const res = action === "approve" ? await approveDevice(code) : await denyDevice(code);
    setPending(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setOutcome(action === "approve" ? "approved" : "denied");
  }

  const settled = outcome ?? (state === "approved" || state === "denied" ? state : null);

  if (settled === "approved") {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Device connected</h1>
        <p className="text-sm text-[var(--muted)]">
          Your terminal is signed in{email ? <> as <span className="text-[var(--fg)]">{email}</span></> : null}. You can
          close this tab and go back to it.
        </p>
        <ButtonLink href="/" full>
          Open the dashboard
        </ButtonLink>
      </div>
    );
  }

  if (settled === "denied") {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Request refused</h1>
        <p className="text-sm text-[var(--muted)]">
          Nothing was granted. The waiting terminal will say the request was denied.
        </p>
        <ButtonLink href="/" full variant="ghost">
          Open the dashboard
        </ButtonLink>
      </div>
    );
  }

  if (state === "invalid") {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Code not recognized</h1>
        <p className="text-sm text-[var(--muted)]">
          {/* Deliberately one message for "never existed", "already used" and "expired" — a page
              that distinguishes them tells anyone guessing codes which guesses were close. */}
          That code isn’t valid any more. Codes last 15 minutes and can only be used once — run
          the command again to get a fresh one.
        </p>
        <ButtonLink href="/device" full variant="ghost">
          Enter a different code
        </ButtonLink>
      </div>
    );
  }

  if (state === "prompt") {
    return (
      <form method="GET" action="/device" className="space-y-4">
        <h1 className="text-xl font-semibold">Connect a device</h1>
        <p className="text-sm text-[var(--muted)]">
          Enter the code shown in your terminal.
        </p>
        <Field
          label="Code"
          name="user_code"
          type="text"
          autoFocus
          required
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="ABCD-1234"
          className="text-center font-mono text-lg tracking-[0.2em] uppercase"
        />
        <Button type="submit" full>
          Continue
        </Button>
      </form>
    );
  }

  if (state === "anon") {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Sign in to continue</h1>
        <p className="text-sm text-[var(--muted)]">
          A device is asking to connect with the code{" "}
          {/* `nowrap`: inline in a sentence the code wrapped across two lines at this card's
              width, which makes it unreadable as the one thing on the page to compare. */}
          <span className="whitespace-nowrap font-mono text-[var(--fg)]">{shown}</span>. Create an
          account or sign in, and you’ll come straight back here.
        </p>
        {/* `?redirect=` carries the code through the auth pages — that's what makes
            `papervine signup` one uninterrupted flow (see lib/safe-redirect.ts). */}
        <ButtonLink href={`/signup?redirect=${encodeURIComponent(resume)}`} full>
          Create an account
        </ButtonLink>
        <p className="text-center text-sm text-[var(--muted)]">
          Already have an account?{" "}
          <Link
            href={`/login?redirect=${encodeURIComponent(resume)}`}
            className="text-[var(--blue)] hover:underline"
          >
            Sign in
          </Link>
        </p>
      </div>
    );
  }

  // state === "confirm"
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Connect this device?</h1>
      <p className="text-sm text-[var(--muted)]">
        <span className="font-mono text-[var(--fg)]">{clientId || "An unidentified client"}</span>{" "}
        is asking for access to your Papervine account
        {email ? (
          <>
            {" "}
            (<span className="text-[var(--fg)]">{email}</span>)
          </>
        ) : null}
        .
      </p>
      <div className="rounded-lg border border-[rgba(var(--ink-rgb),0.08)] bg-[rgba(var(--ink-rgb),0.03)] px-4 py-3 text-center">
        <span className="font-mono text-lg tracking-[0.2em] text-[var(--fg)]">{shown}</span>
      </div>
      <p className="text-sm text-[var(--muted)]">
        Only continue if this code matches the one in your own terminal. Approving gives the
        device the same access you have{scope ? ` (requested scope: ${scope})` : ""}.
      </p>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <Button full disabled={pending !== null} onClick={() => act("approve")}>
        {pending === "approve" ? "Connecting…" : "Approve"}
      </Button>
      {/* Refusing gets a real button, not a link tucked underneath: someone who did not start
          this flow is exactly the person this page has to serve well. */}
      <Button
        full
        variant="ghost"
        disabled={pending !== null}
        onClick={() => act("deny")}
      >
        {pending === "deny" ? "Refusing…" : "I didn’t start this — refuse"}
      </Button>
    </div>
  );
}
