"use client";

import { useState, useTransition } from "react";
import { Trash2, CheckCircle2, Loader2 } from "lucide-react";
import {
  setCustomDomain,
  removeCustomDomain,
  verifyCustomDomain,
  type DomainActionState,
} from "./actions";
import type { DomainVerification } from "@/lib/vercel-domains";
import { Switch } from "@/components/ui/switch";

export function DomainSetupForm({
  initialDomain,
  initialSubpath,
  verified,
  cnameTarget,
  verificationRecords,
}: {
  initialDomain: string;
  initialSubpath: boolean;
  verified: boolean;
  cnameTarget: string;
  verificationRecords: DomainVerification[];
}) {
  const [domain, setDomain] = useState(initialDomain);
  const [subpath, setSubpath] = useState(initialSubpath);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const connected = initialDomain !== "";

  function run(fn: () => Promise<DomainActionState>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
    });
  }

  return (
    <div className="mt-8 max-w-2xl">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h2 className="text-base font-medium">Enter your custom domain</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            You can host your docs at the root of the domain, or under{" "}
            <code className="text-[var(--fg)]">/docs</code>.
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-2 pt-0.5 text-sm text-[var(--muted)]">
          Host at <code className="text-[var(--fg)]">/docs</code>
          <Switch
            checked={subpath}
            onCheckedChange={setSubpath}
            aria-label="Host docs under /docs"
          />
        </label>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <div className="flex flex-1 items-stretch overflow-hidden rounded-lg border border-white/[0.08]">
          <span className="flex items-center bg-white/[0.04] px-3 text-sm text-[var(--muted)]">
            https://
          </span>
          <input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="docs.acme.com"
            spellCheck={false}
            autoCapitalize="none"
            className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm text-[var(--fg)] outline-none placeholder:text-[var(--muted)]/60"
          />
        </div>
        {connected && (
          <button
            type="button"
            aria-label="Remove domain"
            disabled={pending}
            onClick={() => {
              run(removeCustomDomain);
              setDomain("");
              setSubpath(false);
            }}
            className="rounded-lg border border-white/[0.08] p-2.5 text-[var(--muted)] transition-colors hover:text-[var(--fg)] disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          disabled={pending || domain.trim() === ""}
          onClick={() => run(() => setCustomDomain({ domain, subpath }))}
          className="db-cta rounded-lg px-4 py-2 text-sm disabled:opacity-50"
        >
          {pending ? "Saving…" : connected ? "Update domain" : "Connect domain"}
        </button>

        {connected &&
          (verified ? (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Connected
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 text-xs text-[var(--muted)]">
              <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-500/10 px-2.5 py-1 font-medium text-amber-400">
                {pending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                Pending DNS
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(verifyCustomDomain)}
                className="underline-offset-2 hover:text-[var(--fg)] hover:underline disabled:opacity-50"
              >
                Check again
              </button>
            </span>
          ))}
      </div>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      {connected && !verified && (
        <div className="db-feature mt-6 rounded-lg px-4 py-3 text-sm text-[var(--muted)]">
          <div className="font-medium text-[var(--fg)]">Point your DNS here</div>
          <p className="mt-1">
            Add a <code className="text-[var(--fg)]">CNAME</code> record for{" "}
            <code className="text-[var(--fg)]">{initialDomain}</code> targeting{" "}
            <code className="text-[var(--fg)]">{cnameTarget}</code>. Once it
            propagates, this flips to <span className="text-emerald-400">Connected</span>.
          </p>

          {/* Vercel only demands an ownership challenge when the host (or its apex) is
              already in use elsewhere on the platform — so this block is usually empty. */}
          {verificationRecords.length > 0 && (
            <div className="mt-3 border-t border-white/[0.08] pt-3">
              <div className="font-medium text-[var(--fg)]">
                Also add {verificationRecords.length === 1 ? "this record" : "these records"} to
                verify ownership
              </div>
              <div className="mt-2 space-y-2">
                {verificationRecords.map((r, i) => (
                  <div key={i} className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                    <span className="text-xs uppercase text-[var(--muted)]/70">Type</span>
                    <code className="text-[var(--fg)]">{r.type}</code>
                    <span className="text-xs uppercase text-[var(--muted)]/70">Name</span>
                    <code className="break-all text-[var(--fg)]">{r.domain}</code>
                    <span className="text-xs uppercase text-[var(--muted)]/70">Value</span>
                    <code className="break-all text-[var(--fg)]">{r.value}</code>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
