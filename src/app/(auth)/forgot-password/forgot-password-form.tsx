"use client";

import { useState } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/platform/Button";
import { Field } from "@/components/platform/Field";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    // Absolute app-host URL: Better Auth validates it against trustedOrigins and hands it to
    // the browser as a redirect after the token checks out. A bare path would resolve against
    // whichever host served the reset endpoint (the apex).
    const { error } = await authClient.requestPasswordReset({
      email,
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setPending(false);
    if (error) {
      setError(error.message ?? "Couldn't send the reset email");
      return;
    }
    setSent(true);
  }

  // Deliberately the same confirmation whether or not the address exists — the server says the
  // same thing for the same reason. A "no such account" message turns this form into an oracle
  // for which emails have Papervine accounts.
  if (sent) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Check your inbox</h1>
        <p className="text-sm text-[var(--muted)]">
          If an account exists for <strong className="text-[var(--fg)]">{email}</strong>, a link
          to choose a new password is on its way. It expires in an hour.
        </p>
        <p className="text-center text-sm text-[var(--muted)]">
          <Link href="/login" className="text-[var(--blue)] hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <h1 className="text-xl font-semibold">Reset your password</h1>
      <p className="text-sm text-[var(--muted)]">
        Enter the email on your account and we&apos;ll send you a link to choose a new password.
      </p>
      <Field
        label="Email"
        type="email"
        value={email}
        autoFocus
        required
        onChange={(e) => setEmail(e.target.value)}
      />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <Button type="submit" full disabled={pending}>
        {pending ? "Sending…" : "Send reset link"}
      </Button>
      <p className="text-center text-sm text-[var(--muted)]">
        Remembered it?{" "}
        <Link href="/login" className="text-[var(--blue)] hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
