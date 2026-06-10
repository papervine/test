import { Sparkles, ArrowUp } from "lucide-react";
import { AutomateHeader } from "@/components/app/automate/AutomateHeader";

// Automate › Assistant (SPEC §10.2 / §8.6). Scaffold of the in-docs AI assistant
// onboarding: try a starter question or ask your own, with a note on where the
// assistant appears. Inert — nothing here is wired to retrieval yet.
const STARTERS = [
  "How do I get started?",
  "What does this product do?",
  "Show me the API reference",
];

export default function AssistantPage() {
  return (
    <div className="px-8 py-6">
      <AutomateHeader page="Assistant" />

      <div className="mx-auto mt-16 max-w-xl text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.02]">
          <Sparkles className="h-5 w-5" />
        </span>
        <h1 className="mt-6 text-lg font-semibold">Try your assistant</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-[var(--muted)]">
          Ask a question the way your readers will. The assistant answers from your docs
          and cites the pages it used — live in the docs site, search, and over MCP.
        </p>

        <div className="mt-8 space-y-2.5 text-left">
          {STARTERS.map((q) => (
            <button
              key={q}
              disabled
              className="flex w-full cursor-not-allowed items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-left text-sm text-[var(--muted)]"
            >
              {q}
            </button>
          ))}
        </div>

        <div className="mt-8 flex items-center gap-3 text-left">
          <input
            disabled
            placeholder="Ask anything about your docs…"
            className="flex-1 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3 text-sm placeholder:text-[var(--muted)]/70"
          />
          <button
            disabled
            className="flex h-11 w-11 shrink-0 cursor-not-allowed items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.02] text-[var(--muted)]"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-6 text-xs text-[var(--muted)]/70">
          Configure deflection, starter questions, and bot protection in assistant
          settings.
        </p>
      </div>
    </div>
  );
}
