"use client";

import { useState, useTransition } from "react";
import { Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

/**
 * The gallery's "+ Connect" button (SPEC §10.2).
 *
 * Client-side because the whole point is Nango's Connect UI: our server mints a
 * short-lived session token, and their popup runs the provider's OAuth dance. The
 * credential goes straight from the provider to Nango's vault — it never passes through
 * this page, this route, or our database.
 *
 * The connection ROW is written by Nango's webhook, not here, so a successful popup and
 * a visible connected card are two different events. We refresh on close and let the
 * server component tell the truth; a webhook that hasn't landed yet shows as still
 * unconnected rather than as an optimistic row that might never be real.
 */
export function ConnectSource({
  org,
  provider,
  name,
  disabled,
  disabledReason,
}: {
  org: string;
  provider: string;
  name: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  async function connect() {
    setBusy(true);
    try {
      const res = await fetch("/api/integrations/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org, provider }),
      });
      const body = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
      if (!res.ok || !body.token) {
        toast.error(body.error ?? `Couldn't start the ${name} connection.`);
        return;
      }

      // Loaded on demand: the SDK is only needed by someone actually connecting, and
      // keeping it out of the initial bundle keeps the dashboard's cost unchanged for
      // everyone who never clicks this.
      const { default: Nango } = await import("@nangohq/frontend");
      const nango = new Nango({ connectSessionToken: body.token });
      const connect = nango.openConnectUI({
        onEvent: (event) => {
          if (event.type === "close") {
            // The webhook writes the row; re-read rather than guess at the outcome.
            startTransition(() => router.refresh());
          }
          if (event.type === "connect") {
            toast.success(`${name} connected.`);
          }
        },
      });
      connect.setSessionToken(body.token);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Couldn't connect ${name}.`);
    } finally {
      setBusy(false);
    }
  }

  const isBusy = busy || pending;
  return (
    <button
      type="button"
      onClick={connect}
      disabled={disabled || isBusy}
      title={disabled ? disabledReason : undefined}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-[rgba(var(--ink-rgb),0.1)] bg-[rgba(var(--ink-rgb),0.02)] px-4 py-2 text-sm font-medium hover:bg-[rgba(var(--ink-rgb),0.05)] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {isBusy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Plus className="h-4 w-4" />
      )}
      Connect
    </button>
  );
}
