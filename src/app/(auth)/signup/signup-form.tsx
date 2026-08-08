"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { signUp } from "@/lib/auth-client";
import { Button } from "@/components/platform/Button";
import { Field } from "@/components/platform/Field";
import { GoogleSignIn } from "../GoogleSignIn";
import {
  invitedEmailFromUrl,
  oauthErrorFromUrl,
  postAuthDest,
} from "../post-auth-dest";

export function SignupForm({ google }: { google: boolean }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  // Prefill from a `?email=` invite param after mount (not a useState initializer — that runs
  // during SSR with no `window`, and the client reuses that empty value). Same for a
  // bounced-back social sign-in's `?error=`.
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
    const { error } = await signUp.email({ name, email, password });
    setPending(false);
    if (error) {
      setError(error.message ?? "Sign up failed");
      return;
    }
    // Hard nav to the app-host root resolver (forwards to onboarding for a brand-new account
    // with no org yet, or to the accept page when an invite is pending). A soft push would
    // skip the app-host Host rewrite.
    window.location.assign(postAuthDest());
  }

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="space-y-4">
        <h1 className="text-xl font-semibold">Create your Papervine account</h1>
        <Field
          label="Name"
          type="text"
          value={name}
          autoFocus
          required
          onChange={(e) => setName(e.target.value)}
        />
        <Field
          label="Email"
          type="email"
          value={email}
          required
          onChange={(e) => setEmail(e.target.value)}
        />
        <Field
          label="Password"
          type="password"
          value={password}
          required
          minLength={8}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <Button type="submit" full disabled={pending}>
          {pending ? "Creating account…" : "Sign up"}
        </Button>
      </form>
      {google && <GoogleSignIn label="Sign up with Google" />}
      <p className="text-center text-sm text-[var(--muted)]">
        Already have an account?{" "}
        <Link href="/login" className="text-[var(--blue)] hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
