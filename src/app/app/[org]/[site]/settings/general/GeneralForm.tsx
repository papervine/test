"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setSiteName, type SiteRef } from "./actions";

export function GeneralForm({
  siteRef,
  name: initial,
  canManage,
}: {
  siteRef: SiteRef;
  name: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = name.trim().length > 0 && name.trim() !== initial.trim();

  function save() {
    setError(null);
    setSaved(false);
    start(async () => {
      const res = await setSiteName(siteRef, name);
      if (res.error) {
        setError(res.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div className="mt-8 grid max-w-3xl gap-x-10 gap-y-3 md:grid-cols-[260px_1fr] md:items-start">
      <div>
        <h2 className="text-sm font-semibold">Project name</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">Name displayed across the dashboard.</p>
      </div>
      <div>
        <input
          value={name}
          disabled={!canManage}
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
          }}
          className="w-full rounded-lg border border-[rgba(var(--ink-rgb),0.08)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[rgba(var(--ink-rgb),0.2)] disabled:opacity-60"
        />
        {canManage && (
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              disabled={!dirty || pending}
              onClick={save}
              className="db-cta rounded-lg px-4 py-2 text-sm disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save changes"}
            </button>
            {error && <span className="text-sm text-red-400">{error}</span>}
            {saved && !pending && !dirty && (
              <span className="text-sm text-emerald-400">Saved</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
