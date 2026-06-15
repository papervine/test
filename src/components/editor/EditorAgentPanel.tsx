"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import { ArrowUp, Sparkles } from "lucide-react";

// The editor's left-panel editing agent (SPEC §9.2). Same read/write backend as the human
// editor (one draft buffer). When the agent finishes a write tool, it nudges the parent to
// refetch the affected page so the editor pane reflects the agent's edit (pull-on-signal).
const WRITE_TOOLS = new Set(["tool-write_page", "tool-edit_page", "tool-delete_page"]);

type Part = { type: string; text?: string; state?: string };

export function EditorAgentPanel({
  org,
  site,
  branch,
  onAgentWrite,
}: {
  org: string;
  site: string;
  branch: string;
  onAgentWrite: () => void;
}) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const seen = useRef(0);

  const { messages, sendMessage, status, stop } = useChat({
    transport: new DefaultChatTransport({ api: "/api/editor-agent" }),
  });

  const busy = status === "submitted" || status === "streaming";

  const ask = (text: string) => {
    const t = text.trim();
    if (!t) return;
    sendMessage({ text: t }, { body: { org, site, branch } });
    setInput("");
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    // Refresh the editor pane when a write tool completes (count completed write parts).
    let completed = 0;
    for (const m of messages) {
      for (const p of m.parts as Part[]) {
        if (WRITE_TOOLS.has(p.type) && p.state === "output-available") completed++;
      }
    }
    if (completed > seen.current) {
      seen.current = completed;
      onAgentWrite();
    }
  }, [messages, onAgentWrite]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4">
        {messages.length === 0 ? (
          <p className="mx-auto max-w-[16rem] pt-8 text-center text-sm text-neutral-400">
            Ask the agent to edit your docs — e.g. “rewrite the intro” or “add an FAQ entry”.
          </p>
        ) : (
          <div className="space-y-4">
            {messages.map((m) => (
              <AgentMessage key={m.id} role={m.role} parts={m.parts as Part[]} />
            ))}
            {busy && <p className="text-xs text-neutral-400">Working…</p>}
          </div>
        )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          busy ? stop() : ask(input);
        }}
        className="shrink-0 p-3"
      >
        <div className="flex items-end gap-2 rounded-xl border border-neutral-300 p-2 focus-within:border-green-500 dark:border-neutral-700">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                ask(input);
              }
            }}
            rows={1}
            placeholder='Try "expand more about…"'
            className="max-h-40 flex-1 resize-none bg-transparent py-1.5 text-sm outline-none placeholder:text-neutral-400"
          />
          <button
            type="submit"
            aria-label={busy ? "Stop" : "Send"}
            disabled={!busy && !input.trim()}
            className="rounded-lg bg-green-600 p-1.5 text-white disabled:opacity-40"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
        <p className="pt-1.5 text-center text-[11px] text-neutral-400">Agent is in beta and may make mistakes.</p>
      </form>
    </div>
  );
}

function AgentMessage({ role, parts }: { role: string; parts: Part[] }) {
  if (role === "user") {
    const text = parts.filter((p) => p.type === "text").map((p) => p.text).join("");
    return (
      <div className="ml-auto w-fit max-w-[85%] rounded-2xl bg-green-600 px-3 py-1.5 text-sm text-white">{text}</div>
    );
  }
  return (
    <div className="space-y-2 text-sm text-neutral-800 dark:text-neutral-200">
      {parts.map((part, i) => {
        if (part.type === "text" && part.text) {
          return (
            <Streamdown key={i} className="prose-assistant">
              {part.text}
            </Streamdown>
          );
        }
        if ((part.type.startsWith("tool-") || part.type === "dynamic-tool") && part.state) {
          const name = part.type.replace(/^tool-/, "");
          const label = WRITE_TOOLS.has(part.type)
            ? "Editing the docs…"
            : name === "searchDocs" || name === "search"
              ? "Searching…"
              : name === "readPage" || name === "read"
                ? "Reading a page…"
                : name === "publish"
                  ? "Publishing…"
                  : "Working…";
          return (
            <p key={i} className="flex items-center gap-1.5 text-xs text-neutral-400">
              <Sparkles className="h-3 w-3" /> {label}
            </p>
          );
        }
        return null;
      })}
    </div>
  );
}
