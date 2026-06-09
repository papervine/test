"use client";

import { useActionState } from "react";
import Link from "next/link";
import { connectRepo, type ConnectState } from "@/lib/actions/sites";
import { Button } from "@/components/platform/Button";
import { Field } from "@/components/platform/Field";

const initial: ConnectState = {};

export default function ConnectRepoPage() {
  const [state, formAction, pending] = useActionState(connectRepo, initial);

  return (
    <div className="mx-auto max-w-lg px-8 py-12">
      <Link
        href="/dashboard"
        className="text-sm text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
      >
        ← Back
      </Link>
      <h1 className="mt-4 text-2xl font-semibold">Connect a repository</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Point Papervine at a public GitHub repo with a <code>docs.json</code> at
        its root.
      </p>

      <form action={formAction} className="mt-8 space-y-5">
        <Field
          name="name"
          label="Site name"
          placeholder="Acme Docs"
          autoFocus
          required
        />
        <Field
          name="repo"
          label="GitHub repository"
          placeholder="owner/name or github.com URL"
          required
        />
        <Field
          name="branch"
          label="Branch"
          placeholder="defaults to the repo's default branch"
        />

        {state.error && <p className="text-sm text-red-400">{state.error}</p>}

        <Button type="submit" full disabled={pending}>
          {pending ? "Connecting…" : "Connect repository"}
        </Button>
      </form>
    </div>
  );
}
