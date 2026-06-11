"use client";

import { useState } from "react";
import Link from "next/link";
import { signIn } from "@/lib/auth-client";
import { Button } from "@/components/platform/Button";
import { Field } from "@/components/platform/Field";

export default function LoginPage() {
  const [email, setEmail] = useState("");
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
    // Hard nav to the app-host root resolver — it forwards to the user's first site. A
    // soft router.push into the Host-rewritten /app mount would skip the rewrite.
    window.location.assign("/");
  }

  return (
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
      {error && <p className="text-sm text-red-400">{error}</p>}
      <Button type="submit" full disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <p className="text-center text-sm text-[var(--muted)]">
        No account?{" "}
        <Link href="/signup" className="text-[var(--blue)] hover:underline">
          Sign up
        </Link>
      </p>
    </form>
  );
}
