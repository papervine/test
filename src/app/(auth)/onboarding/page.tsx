"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

// First-run: create the organization (tenant) the user will own. Slug doubles as
// the *.docbot.app subdomain, so it must be URL-safe.
export default function OnboardingPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function slugify(v: string) {
    return v
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const { error } = await authClient.organization.create({
      name,
      slug: slugify(name),
    });
    setPending(false);
    if (error) {
      setError(error.message ?? "Could not create organization");
      return;
    }
    router.push("/dashboard");
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <h1 className="text-xl font-semibold">Name your organization</h1>
      <p className="text-sm text-neutral-400">
        This is your workspace — it owns your docs sites and team.
      </p>
      <label className="block">
        <span className="mb-1 block text-sm text-neutral-300">Organization name</span>
        <input
          type="text"
          value={name}
          autoFocus
          required
          onChange={(e) => setName(e.target.value)}
          placeholder="Acme Inc"
          className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
        />
        {name && (
          <span className="mt-1 block text-xs text-neutral-500">
            {slugify(name) || "—"}.docbot.app
          </span>
        )}
      </label>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-emerald-500 py-2 text-sm font-medium text-neutral-950 hover:bg-emerald-400 disabled:opacity-50"
      >
        {pending ? "Creating…" : "Create organization"}
      </button>
    </form>
  );
}
