"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { signIn } from "@/lib/auth-client";
import { Button } from "@/components/platform/Button";
import { Field } from "@/components/platform/Field";
import { GoogleSignIn } from "../GoogleSignIn";
import {
  invitedEmailFromUrl,
  oauthErrorFromUrl,
  postAuthDest,
} from "../post-auth-dest";

export function LoginForm({ google, email: emailEnabled }: { google: boolean; email: boolean }) {
  const [email, setEmail] = useState("");
  // Prefill from a `?email=` invite param after mount (a useState initializer runs during SSR
  // with no `window`, and the client reuses that empty value). Same for a bounced-back social
  // sign-in's `?error=`.
  useEffect(() => {
    const invited = invitedEmailFromUrl();
    if (invited) setEmail(invited);
    setError(oauthErrorFromUrl());
  }, []);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const { error } = await signIn.email({ email, password });
    setPending(false);
    if (error) {
      setError(error.message ?? "Sign in failed");
      return;
    }
    // Hard nav to the app-host root resolver — it forwards to the user's first site (or the
    // accept page when an invite is pending). A soft router.push into the Host-rewritten /app
    // mount would skip the rewrite.
    window.location.assign(postAuthDest());
  }

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="space-y-4">
        <h1 className="text-xl font-semibold">Sign in to Papervine</h1>
        <Field
          label="Email"
          type="email"
          value={email}
          autoFocus
          required
          onChange={(e) => setEmail(e.target.value)}
        />
        <Field
          label="Password"
          type="password"
          value={password}
          required
          onChange={(e) => setPassword(e.target.value)}
        />
        {/* Only offered when a provider can actually deliver the link — otherwise the flow
            dead-ends at a "check your inbox" for an email nobody sent. */}
        {emailEnabled && (
          <p className="text-right text-sm">
            <Link
              href="/forgot-password"
              className="text-[var(--muted)] hover:text-[var(--fg)] hover:underline"
            >
              Forgot password?
            </Link>
          </p>
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}
        <Button type="submit" full disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      {google && <GoogleSignIn label="Continue with Google" />}
      <p className="text-center text-sm text-[var(--muted)]">
        No account?{" "}
        <Link href="/signup" className="text-[var(--blue)] hover:underline">
          Sign up
        </Link>
      </p>
    </div>
  );
}
