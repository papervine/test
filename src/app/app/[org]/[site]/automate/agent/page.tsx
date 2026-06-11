import { Send } from "lucide-react";
import { AutomateHeader } from "@/components/app/automate/AutomateHeader";

// Automate › Agent (SPEC §10.2). Scaffold of the Slack-agent onboarding empty state:
// pick a starter prompt or write your own, addressed to the agent and a Slack channel.
// Inert — the inputs and "Send message" don't post anywhere yet.
const STARTERS = [
  "What pages haven't been edited in a while. Help me remove some pages",
  "Document this new feature we shipped",
  "Update my changelog",
];

// Placeholder channel list. Real version is fetched from the connected Slack
// workspace (conversations.list) — see SPEC §10.2.
const CHANNELS = [
  "aspera-status",
  "billing-updates",
  "code-reviews",
  "deluxeuploads",
  "editor-bay",
  "encoding",
  "focus-features",
  "general",
  "gfx-automation",
  "graphics",
  "hr-pto",
  "infosec-stream",
  "intercom",
  "jam",
  "knowledge",
];

export default function AgentPage() {
  return (
    <div className="px-8 py-6">
      <AutomateHeader page="Agent" />

      <div className="mx-auto mt-16 max-w-xl text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.02]">
          <Send className="h-5 w-5" />
        </span>
        <h1 className="mt-6 text-lg font-semibold">Send your first message</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-[var(--muted)]">
          Try out the agent right now. Pick a prompt below or write your own — it&apos;ll
          be sent directly to the agent channel in Slack.
        </p>

        <div className="mt-8 space-y-2.5 text-left">
          {STARTERS.map((prompt) => (
            <button
              key={prompt}
              disabled
              className="flex w-full cursor-not-allowed items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-left"
            >
              <span className="shrink-0 text-sm font-medium text-[var(--fg)]">
                @papervine
              </span>
              <span className="text-sm text-[var(--muted)]">{prompt}</span>
            </button>
          ))}
        </div>

        <div className="mt-8 text-left">
          <p className="text-sm font-semibold">or your own prompt</p>
          <textarea
            rows={3}
            disabled
            placeholder="@papervine"
            className="mt-2 w-full resize-none rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3 text-sm placeholder:text-[var(--muted)]/70"
          />
          <div className="mt-3 flex items-center gap-3">
            <select
              defaultValue="general"
              aria-label="Slack channel"
              className="flex-1 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-2.5 text-sm"
            >
              {CHANNELS.map((c) => (
                <option key={c} value={c} className="bg-[var(--bg)]">
                  #{c}
                </option>
              ))}
            </select>
            <button
              disabled
              className="cursor-not-allowed rounded-xl border border-white/[0.08] bg-white/[0.02] px-5 py-2.5 text-sm font-medium text-[var(--muted)]"
            >
              Send message
            </button>
          </div>
        </div>

        <button
          disabled
          className="mt-6 w-full cursor-not-allowed rounded-xl border border-white/[0.08] px-4 py-3 text-sm font-medium"
        >
          Skip for now
        </button>

        {/* Onboarding carousel position (scaffold — third of three steps) */}
        <div className="mt-8 flex items-center justify-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-white/20" />
          <span className="h-1.5 w-1.5 rounded-full bg-white/20" />
          <span className="h-1.5 w-6 rounded-full bg-white/60" />
        </div>
      </div>
    </div>
  );
}
