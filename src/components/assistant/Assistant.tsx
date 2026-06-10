"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Streamdown } from "streamdown";
import { Sparkles, X, Maximize2, Minimize2, ArrowUp, Paperclip } from "lucide-react";
import clsx from "clsx";

/** Custom event other components dispatch to open the assistant (optionally with a query). */
export const OPEN_EVENT = "papervine:open-assistant";
export function openAssistant(query?: string) {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { query } }));
}

export function Assistant({ site }: { site?: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { messages, sendMessage, status, stop } = useChat({
    transport: new DefaultChatTransport({ api: "/api/assistant" }),
  });

  const ask = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      // `site` scopes retrieval to this tenant in path mode (apex `/sites/{slug}`),
      // where the request can't carry the tenant in its Host header. See route.ts.
      sendMessage({ text: trimmed }, { body: { pageSlug: pathname, site } });
      setInput("");
    },
    [sendMessage, pathname, site],
  );

  // Open triggers: navbar button / Cmd-I / ?assistant= deep link.
  useEffect(() => {
    const onOpen = (e: Event) => {
      setOpen(true);
      const q = (e as CustomEvent<{ query?: string }>).detail?.query;
      if (q) ask(q);
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "i") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    window.addEventListener("keydown", onKey);

    const url = new URL(window.location.href);
    const deepLink = url.searchParams.get("assistant");
    if (deepLink) {
      setOpen(true);
      ask(deepLink);
    }
    return () => {
      window.removeEventListener(OPEN_EVENT, onOpen);
      window.removeEventListener("keydown", onKey);
    };
  }, [ask]);

  // Keep the transcript pinned to the latest message.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  // Focus the composer when the panel opens so the user can type straight away.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const busy = status === "submitted" || status === "streaming";
  const lastIsUser = messages[messages.length - 1]?.role === "user";

  return (
    <div
      className={clsx(
        "fixed bottom-0 right-0 top-0 z-50 flex flex-col border-l border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950",
        expanded ? "w-full md:w-[48rem]" : "w-full sm:w-[28rem]",
      )}
    >
      {/* Header */}
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-zinc-200 px-4 dark:border-zinc-800">
        <div className="flex items-center gap-2 font-semibold text-zinc-900 dark:text-zinc-100">
          <Sparkles className="h-5 w-5 text-primary" />
          Assistant
        </div>
        <div className="flex items-center gap-1 text-zinc-500">
          <button
            onClick={() => setExpanded((e) => !e)}
            aria-label={expanded ? "Collapse" : "Expand"}
            className="rounded-md p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="rounded-md p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Transcript */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
        {messages.length === 0 ? (
          <p className="mx-auto max-w-sm text-center text-sm text-zinc-400">
            Responses are generated using AI and may contain mistakes.
          </p>
        ) : (
          <div className="space-y-5">
            {messages.map((m) => (
              <Message key={m.id} role={m.role} parts={m.parts} />
            ))}
            {busy && lastIsUser && (
              <p className="text-sm text-zinc-400">Thinking…</p>
            )}
          </div>
        )}
      </div>

      {/* Composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (busy) stop();
          else ask(input);
        }}
        className="shrink-0 border-t border-zinc-200 p-3 dark:border-zinc-800"
      >
        <div className="flex items-end gap-2 rounded-xl border border-zinc-300 p-2 focus-within:border-primary dark:border-zinc-700">
          <button type="button" aria-label="Attach" disabled className="p-1.5 text-zinc-400" title="Attachments coming soon">
            <Paperclip className="h-4 w-4" />
          </button>
          <textarea
            ref={inputRef}
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                ask(input);
              }
            }}
            rows={1}
            placeholder="Ask a question…"
            className="max-h-40 flex-1 resize-none bg-transparent py-1.5 text-sm outline-none placeholder:text-zinc-400"
          />
          <button
            type="submit"
            aria-label={busy ? "Stop" : "Send"}
            className="rounded-lg bg-primary p-1.5 text-white disabled:opacity-40"
            disabled={!busy && !input.trim()}
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
      </form>
    </div>
  );
}

// Citation/link styling for assistant answers: keep the body text color (white in the
// dark panel, dark in light) with a blue underline — links read as text, not blue text.
const streamdownComponents = {
  a: ({ href, children, ...props }: { href?: string; children?: ReactNode }) => {
    const external = !!href && /^https?:\/\//.test(href);
    return (
      <a
        href={href}
        {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
        className="text-inherit underline decoration-blue-500 underline-offset-2 hover:decoration-blue-400"
        {...props}
      >
        {children}
      </a>
    );
  },
};

type Part = { type: string; text?: string; state?: string };

function Message({ role, parts }: { role: string; parts: Part[] }) {
  if (role === "user") {
    const text = parts.filter((p) => p.type === "text").map((p) => p.text).join("");
    return (
      <div className="ml-auto w-fit max-w-[85%] rounded-2xl bg-primary px-4 py-2 text-sm text-white">
        {text}
      </div>
    );
  }

  return (
    <div className="space-y-2 text-sm text-zinc-800 dark:text-zinc-200">
      {parts.map((part, i) => {
        if (part.type === "text" && part.text) {
          return (
            <Streamdown key={i} className="prose-assistant" components={streamdownComponents}>
              {part.text}
            </Streamdown>
          );
        }
        // Tool activity (searchDocs / readPage / …) shown as a subtle step.
        if (part.type.startsWith("tool-") || part.type === "dynamic-tool") {
          const name = part.type.replace(/^tool-/, "");
          if (part.state === "output-available" || part.state === "input-available") {
            return (
              <p key={i} className="flex items-center gap-1.5 text-xs text-zinc-400">
                <Sparkles className="h-3 w-3" />
                {name === "searchDocs" || name === "searchApi"
                  ? "Searching the docs…"
                  : name === "readPage"
                    ? "Reading a page…"
                    : "Working…"}
              </p>
            );
          }
        }
        return null;
      })}
    </div>
  );
}
