"use client";

import { useState } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/platform/Button";
import { Field } from "@/components/platform/Field";

// `token`/`invalid` come from the server component (see page.tsx) so the right state renders
// on the first paint instead of flashing the form at someone whose link is expired.
export function ResetPasswordForm({
  token,
  invalid,
}: {
  token: string | null;
  invalid: boolean;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Those passwords don't match");
      return;
    }
    if (!token) return;
    setPending(true);
    setError(null);
    const { error } = await authClient.resetPassword({ newPassword: password, token });
    setPending(false);
    if (error) {
      setError(error.message ?? "Couldn't reset your password");
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Password updated</h1>
        <p className="text-sm text-[var(--muted)]">
          You can sign in with your new password. Any other devices that were signed in have
          been signed out.
        </p>
        <p className="text-center text-sm text-[var(--muted)]">
          <Link href="/login" className="text-[var(--blue)] hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    );
  }

  if (invalid || !token) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">This link has expired</h1>
        <p className="text-sm text-[var(--muted)]">
          Reset links last an hour and can only be used once. Request a new one to continue.
        </p>
        <p className="text-center text-sm text-[var(--muted)]">
          <Link href="/forgot-password" className="text-[var(--blue)] hover:underline">
            Send a new link
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <h1 className="text-xl font-semibold">Choose a new password</h1>
      <Field
        label="New password"
        type="password"
        value={password}
        autoFocus
        required
        minLength={8}
        onChange={(e) => setPassword(e.target.value)}
      />
      <Field
        label="Confirm new password"
        type="password"
        value={confirm}
        required
        minLength={8}
        onChange={(e) => setConfirm(e.target.value)}
      />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <Button type="submit" full disabled={pending}>
        {pending ? "Saving…" : "Update password"}
      </Button>
    </form>
  );
}
