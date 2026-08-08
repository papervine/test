"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Check, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { setWidgetEnabled, setWidgetAllowedOrigins, type SiteRef } from "./actions";

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label="Copy"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

export function WidgetForm({
  siteRef,
  widgetId,
  initialEnabled,
  initialOrigins,
  apiBase,
}: {
  siteRef: SiteRef;
  widgetId: string;
  initialEnabled: boolean;
  initialOrigins: string[];
  apiBase: string;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [origins, setOrigins] = useState(initialOrigins);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const dirty = JSON.stringify(origins) !== JSON.stringify(initialOrigins);

  function toggleEnabled(next: boolean) {
    setEnabled(next);
    start(async () => {
      const res = await setWidgetEnabled(siteRef, next);
      if (res.error) {
        setError(res.error);
        setEnabled(!next);
        return;
      }
      router.refresh();
    });
  }

  function addDomain() {
    if (!draft.trim()) return;
    setError(null);
    setOrigins((prev) => [...prev, draft.trim()]);
    setDraft("");
  }

  function saveOrigins() {
    setError(null);
    start(async () => {
      const res = await setWidgetAllowedOrigins(siteRef, origins);
      if (res.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  const embedCode = `<script
  type="module"
  src="${apiBase}/api/widget/embed.js"
></script>

<script type="module">
  await window.PapervineAssistant.init({
    id: "${widgetId}",
  });
</script>`;

  const singleTagEmbedCode = `<script
  type="module"
  src="${apiBase}/api/widget/embed.js"
  data-widget-id="${widgetId}"
></script>`;

  return (
    <div className="mt-8 max-w-3xl space-y-10">
      {/* General */}
      <div className="grid gap-x-10 gap-y-3 md:grid-cols-[260px_1fr] md:items-start">
        <div>
          <h2 className="text-sm font-semibold">General</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Control the widget&apos;s availability and install it.
          </p>
        </div>
        <div className="db-feature flex items-start justify-between gap-6 rounded-xl px-5 py-4">
          <div>
            <h3 className="text-sm font-medium">Availability</h3>
            <p className="mt-1 text-sm text-[var(--muted)]">Enable or disable your AI widget.</p>
          </div>
          <Switch checked={enabled} onCheckedChange={toggleEnabled} aria-label="Enable widget" />
        </div>
      </div>

      <div className="border-t border-[rgba(var(--ink-rgb),0.08)]" />

      {/* Authorized domains */}
      <div className="grid gap-x-10 gap-y-3 md:grid-cols-[260px_1fr] md:items-start">
        <div>
          <h2 className="text-sm font-semibold">Authorized domains</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Control which websites can use this widget.
          </p>
        </div>
        <div className="db-feature rounded-xl px-5 py-4">
          <h3 className="text-sm font-medium">Allowed origins</h3>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Only these origins can start Assistant sessions. Include{" "}
            <code className="text-[var(--fg)]">http://</code> or{" "}
            <code className="text-[var(--fg)]">https://</code>. Paths and wildcards aren&apos;t
            supported.
          </p>

          {origins.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {origins.map((origin, i) => (
                <li
                  key={origin}
                  className="flex items-center justify-between rounded-lg border border-[rgba(var(--ink-rgb),0.08)] px-3 py-2 text-sm"
                >
                  <code className="text-[var(--fg)]">{origin}</code>
                  <button
                    type="button"
                    aria-label={`Remove ${origin}`}
                    onClick={() => setOrigins((prev) => prev.filter((_, j) => j !== i))}
                    className="text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3 flex items-center gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addDomain();
                }
              }}
              placeholder="https://docs.example.com"
              spellCheck={false}
              autoCapitalize="none"
              className="min-w-0 flex-1 rounded-lg border border-[rgba(var(--ink-rgb),0.08)] bg-transparent px-3 py-2 text-sm outline-none placeholder:text-[var(--muted)]/60 focus:border-[rgba(var(--ink-rgb),0.2)]"
            />
            <button
              type="button"
              onClick={addDomain}
              disabled={!draft.trim()}
              className="rounded-lg border border-[rgba(var(--ink-rgb),0.08)] px-3 py-2 text-sm transition-colors hover:bg-[rgba(var(--ink-rgb),0.04)] disabled:opacity-50"
            >
              + Add domain
            </button>
          </div>

          <p className="mt-2 text-xs text-[var(--muted)]">
            Add a domain, or save to disable the widget.
          </p>

          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              disabled={!dirty || pending}
              onClick={saveOrigins}
              className="db-cta rounded-lg px-4 py-2 text-sm disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save changes"}
            </button>
            {error && <span className="text-sm text-red-400">{error}</span>}
          </div>
        </div>
      </div>

      <div className="border-t border-[rgba(var(--ink-rgb),0.08)]" />

      {/* Installation */}
      <div className="grid gap-x-10 gap-y-3 md:grid-cols-[260px_1fr] md:items-start">
        <div>
          <h2 className="text-sm font-semibold">Installation</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Add the widget to a website or connect it to a custom experience.
          </p>
        </div>
        <div className="space-y-4">
          <div className="db-feature rounded-xl px-5 py-4">
            <div className="flex items-start justify-between gap-6">
              <div>
                <h3 className="text-sm font-medium">Embed code</h3>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  Add this code to your site to load and initialize the widget.
                </p>
              </div>
              <a
                href="https://papervine.io/features/assistant-widget"
                target="_blank"
                rel="noreferrer"
                className="shrink-0 text-sm text-[var(--muted)] underline-offset-2 hover:text-[var(--fg)] hover:underline"
              >
                View guide ↗
              </a>
            </div>
            <div className="relative mt-3 overflow-hidden rounded-lg border border-[rgba(var(--ink-rgb),0.08)] bg-[rgba(var(--ink-rgb),0.02)]">
              <pre className="overflow-x-auto p-3 text-xs leading-relaxed text-[var(--fg)]">
                <code>{embedCode}</code>
              </pre>
              <div className="absolute right-2 top-2">
                <CopyButton value={embedCode} />
              </div>
            </div>

            <p className="mt-4 text-sm text-[var(--muted)]">
              Prefer a single tag? Add <code className="text-[var(--fg)]">data-widget-id</code>{" "}
              to the loader script instead of the second block above:
            </p>
            <div className="relative mt-2 overflow-hidden rounded-lg border border-[rgba(var(--ink-rgb),0.08)] bg-[rgba(var(--ink-rgb),0.02)]">
              <pre className="overflow-x-auto p-3 text-xs leading-relaxed text-[var(--fg)]">
                <code>{singleTagEmbedCode}</code>
              </pre>
              <div className="absolute right-2 top-2">
                <CopyButton value={singleTagEmbedCode} />
              </div>
            </div>
          </div>

          <div className="db-feature rounded-xl px-5 py-4">
            <h3 className="text-sm font-medium">Widget ID</h3>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Use this ID with the headless client. It is public, safe to expose in
              client-side code, and cannot be changed.
            </p>
            <div className="mt-3 flex items-center justify-between rounded-lg border border-[rgba(var(--ink-rgb),0.08)] px-3 py-2">
              <code className="text-sm text-[var(--fg)]">{widgetId}</code>
              <CopyButton value={widgetId} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
