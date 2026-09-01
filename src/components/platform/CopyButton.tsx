"use client";

import { useState } from "react";
import { Check, Copy, X } from "lucide-react";

/**
 * Copy-to-clipboard icon button for the platform surfaces.
 *
 * Extracted because this was being hand-rolled per form (the widget settings had its own, the
 * reader-auth secret another, invite links a third) and the next surface that wanted one — the MCP
 * page's server URL and client config — would have made it four.
 *
 * Always visible rather than revealed on hover: a control nobody can see is a control nobody uses,
 * and hover-only affordances are also invisible to a keyboard.
 *
 * `navigator.clipboard.writeText` REJECTS in more cases than people expect — a non-secure origin,
 * a denied permission, a document that isn't focused — and the copies this replaces all chained a
 * bare `.then()`, so a failure was an unhandled rejection and a button that appeared to do
 * nothing. Here it resolves to a visible failed state instead: the reader knows to select the text
 * by hand rather than pasting whatever was in the clipboard before.
 */
export function CopyButton({
  value,
  label,
  className = "",
}: {
  value: string;
  /** What's being copied, for the accessible name: "Copy server URL". */
  label: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 1500);
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={state === "failed" ? `Couldn't copy ${label}` : `Copy ${label}`}
      title={state === "failed" ? "Couldn't copy — select the text instead" : `Copy ${label}`}
      className={`flex items-center rounded-md p-1.5 text-[var(--muted)] transition-colors hover:bg-[rgba(var(--ink-rgb),0.07)] hover:text-[var(--fg)] ${className}`}
    >
      {state === "copied" ? (
        <Check className="h-3.5 w-3.5 text-emerald-400" />
      ) : state === "failed" ? (
        <X className="h-3.5 w-3.5 text-[var(--danger)]" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
      {/* The icon swap is the feedback for sighted users; this is the same news for a screen
          reader, which would otherwise hear nothing happen. */}
      <span className="sr-only" role="status">
        {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : ""}
      </span>
    </button>
  );
}
