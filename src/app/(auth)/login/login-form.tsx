"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { signIn } from "@/lib/auth-client";
import { Button } from "@/components/platform/Button";
import { Field } from "@/components/platform/Field";
import { SocialProviders } from "../SocialSignIn";
import {
  invitedEmailFromUrl,
  oauthErrorFromUrl,
  postAuthDest,
} from "../post-auth-dest";

export function LoginForm({ google, github, email: emailEnabled }: { google: boolean; github: boolean; email: boolean }) {
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
    // Validated here rather than by the browser (see `noValidate` below). With native
    // validation, pressing Enter on a form whose email is empty or malformed does NOTHING
    // VISIBLE: no submit event fires, so this handler never runs, the button never enters its
    // pending state, and the only feedback is a bubble anchored to a field the reader may have
    // scrolled past or never focused. It reads exactly like a broken button.
    const address = email.trim();
    if (!address || !password) {
      setError("Enter your email address and password.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError("That doesn't look like an email address.");
      return;
    }

    setPending(true);
    setError(null);
    const { error } = await signIn.email({ email: address, password });
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
      {/* `noValidate` so the messages above are the only ones: two validators disagreeing about
          wording is worse than either alone, and the native one is the invisible half. */}
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <h1 className="text-xl font-semibold">Sign in to Papervine</h1>
        <Field
          label="Email"
          type="email"
          value={email}
          autoFocus
          // `aria-required` rather than `required`: still announced as mandatory, without
          // handing constraint validation back to the browser.
          aria-required
          onChange={(e) => setEmail(e.target.value)}
        />
        <Field
          label="Password"
          type="password"
          value={password}
          aria-required
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
        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}
        <Button type="submit" full disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      <SocialProviders google={google} github={github} action="Continue" />
      <p className="text-center text-sm text-[var(--muted)]">
        No account?{" "}
        <Link href="/signup" className="text-[var(--blue)] hover:underline">
          Sign up
        </Link>
      </p>
    </div>
  );
}
