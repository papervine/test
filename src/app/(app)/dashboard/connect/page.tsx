"use client";

import { useActionState } from "react";
import Link from "next/link";
import { connectRepo, type ConnectState } from "@/lib/actions/sites";

const initial: ConnectState = {};

export default function ConnectRepoPage() {
  const [state, formAction, pending] = useActionState(connectRepo, initial);

  return (
    <div className="mx-auto max-w-lg px-8 py-12">
      <Link href="/dashboard" className="text-sm text-neutral-400 hover:text-neutral-200">
        ← Back
      </Link>
      <h1 className="mt-4 text-2xl font-semibold">Connect a repository</h1>
      <p className="mt-2 text-sm text-neutral-400">
        Point Docbot at a public GitHub repo with a <code>docs.json</code> at its root.
      </p>

      <form action={formAction} className="mt-8 space-y-5">
        <Field name="name" label="Site name" placeholder="Acme Docs" autoFocus />
        <Field name="repo" label="GitHub repository" placeholder="owner/name or github.com URL" />
        <Field name="branch" label="Branch" placeholder="defaults to the repo's default branch" required={false} />

        {state.error && <p className="text-sm text-red-400">{state.error}</p>}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-emerald-500 py-2 text-sm font-medium text-neutral-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {pending ? "Connecting…" : "Connect repository"}
        </button>
      </form>
    </div>
  );
}

function Field({
  name,
  label,
  placeholder,
  autoFocus,
  required = true,
}: {
  name: string;
  label: string;
  placeholder?: string;
  autoFocus?: boolean;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-neutral-300">{label}</span>
      <input
        name={name}
        placeholder={placeholder}
        autoFocus={autoFocus}
        required={required}
        className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
      />
    </label>
  );
}
