"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { slugify } from "@/lib/slug";
import { Button } from "@/components/platform/Button";
import { Field } from "@/components/platform/Field";

// First-run: create the organization (tenant) the user will own. Slug doubles as
// the *.papervine.io subdomain, so it must be URL-safe.
export default function OnboardingPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

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
      <p className="text-sm text-[var(--muted)]">
        This is your workspace — it owns your docs sites and team.
      </p>
      <Field
        label="Organization name"
        type="text"
        value={name}
        autoFocus
        required
        placeholder="Acme Inc"
        onChange={(e) => setName(e.target.value)}
        hint={
          name && (
            <span className="mt-1 block text-xs text-[var(--muted)]">
              {slugify(name) || "—"}.papervine.io
            </span>
          )
        }
      />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <Button type="submit" full disabled={pending}>
        {pending ? "Creating…" : "Create organization"}
      </Button>
    </form>
  );
}
