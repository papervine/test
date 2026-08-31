"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, convertFileListToFileUIParts, type FileUIPart, type UIMessage } from "ai";
import { useEffect, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import {
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileText,
  GitBranch,
  History,
  Paperclip,
  Plus,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";
import { validateAttachments } from "@/lib/agent-attachments";
import { ATTACHMENT_ACCEPT } from "@/lib/agent-attachments";
import { messageCopyText, questionBefore, type AgentRating } from "@/lib/agent-feedback";
import {
  chatAge,
  chatTitle,
  chatsKey,
  compactForStorage,
  parseStoredChats,
  upsertChat,
  type StoredChat,
} from "@/lib/agent-chats";

// The editor's left-panel editing agent (SPEC §9.2). Same read/write backend as the human
// editor (one draft buffer). When the agent finishes a write tool, it nudges the parent to
// refetch the affected page so the editor pane reflects the agent's edit (pull-on-signal).
const WRITE_TOOLS = new Set(["tool-write_page", "tool-edit_page", "tool-delete_page"]);

type Part = { type: string; text?: string; state?: string; mediaType?: string; url?: string; filename?: string };

/** Completed write-tool parts in a conversation — the panel's refresh watermark. */
function completedWrites(messages: UIMessage[]): number {
  let n = 0;
  for (const m of messages) {
    for (const p of m.parts as Part[]) {
      if (WRITE_TOOLS.has(p.type) && p.state === "output-available") n++;
    }
  }
  return n;
}

export function EditorAgentPanel({
  org,
  site,
  branch,
  slug,
  onAgentWrite,
  onClose,
}: {
  org: string;
  site: string;
  branch: string;
  // The page open in the editor RIGHT NOW — sent with every message so "this page" means
  // something to the agent. A prop (not state): the shell updates it on every nav click.
  slug: string;
  onAgentWrite: () => void;
  onClose: () => void;
}) {
  const [input, setInput] = useState("");
  // Context the model gets alongside the text: screenshots to imitate, a CSV to turn into a
  // table, a draft to fold in. Held as the SDK's own file parts (data URLs) so sending is just
  // handing them to sendMessage — nothing is stored anywhere.
  const [attachments, setAttachments] = useState<FileUIPart[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  // Chat history (localStorage — a per-person working context, like an unsent draft; see
  // src/lib/agent-chats.ts for why it isn't server state). `chatId` names the CURRENT chat so
  // saves upsert one entry rather than appending a copy per keystroke. History renders as a
  // view of the panel itself (Back to return), not a dropdown.
  const [chatId, setChatId] = useState(() => `c${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`);
  const [view, setView] = useState<"chat" | "history">("chat");
  const [history, setHistory] = useState<StoredChat[]>([]);
  // Good/Bad per assistant message id. Local for instant feedback, persisted with the chat so a
  // restored conversation keeps its thumbs; the analytics row is written by the POST in rate().
  const [ratings, setRatings] = useState<Record<string, AgentRating>>({});
  const fileInput = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const seen = useRef(0);

  const { messages, sendMessage, setMessages, status, stop } = useChat({
    transport: new DefaultChatTransport({ api: "/api/editor-agent" }),
  });

  const busy = status === "submitted" || status === "streaming";

  const readHistory = () => {
    try {
      return parseStoredChats(window.localStorage.getItem(chatsKey(org, site)));
    } catch {
      return []; // storage can throw (blocked site data) — the panel works without history
    }
  };

  const addFiles = async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    const dt = new DataTransfer();
    for (const f of list) dt.items.add(f);
    const parts = await convertFileListToFileUIParts(dt.files);
    const next = [...attachments, ...parts];
    // The same gate the server applies — refuse HERE, next to the paperclip, rather than
    // spending a round trip to be told the same thing.
    const error = validateAttachments(next);
    if (error) {
      setAttachError(error);
      return;
    }
    setAttachError(null);
    setAttachments(next);
  };

  const ask = (text: string) => {
    const t = text.trim();
    if (!t && attachments.length === 0) return;
    sendMessage(
      { text: t || "See the attached file.", files: attachments },
      { body: { org, site, branch, slug } },
    );
    setInput("");
    setAttachments([]);
    setAttachError(null);
  };

  /** Start over: the current chat is already in history (the save effect below), so just reset. */
  const newChat = () => {
    if (busy) stop();
    setMessages([]);
    seen.current = 0;
    setChatId(`c${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`);
    setInput("");
    setAttachments([]);
    setAttachError(null);
    setRatings({});
    setView("chat");
  };

  /** Bring a past conversation back as the live one. */
  const restoreChat = (chat: StoredChat) => {
    if (busy) stop();
    // The restored transcript may contain completed write tools; without moving the watermark
    // first, the effect below would read them as fresh writes and refetch the page for nothing.
    seen.current = completedWrites(chat.messages);
    setMessages(chat.messages);
    setChatId(chat.id);
    setRatings(chat.ratings ?? {});
    setView("chat");
  };

  /**
   * Good/Bad on an assistant reply. The row lands in the site's analytics as a `feedback`
   * event (SPEC §10.1) — fire-and-forget: a rating is telemetry, the UI never blocks on it.
   */
  const rate = (messageId: string, rating: AgentRating) => {
    if (ratings[messageId] === rating) return; // same thumb twice: nothing new to say
    setRatings((r) => ({ ...r, [messageId]: rating }));
    void fetch("/api/editor-agent/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        org,
        site,
        rating,
        messageId,
        chatId,
        question: questionBefore(messages, messageId),
      }),
    }).catch(() => {});
  };

  // Persist the current chat on every settled change. Compacted (attachment bytes dropped —
  // localStorage's whole budget is ~5MB) and upserted by id, newest first, capped.
  useEffect(() => {
    if (messages.length === 0) return;
    try {
      const list = upsertChat(readHistory(), {
        id: chatId,
        title: chatTitle(messages),
        updatedAt: Date.now(),
        messages: compactForStorage(messages),
        branch,
        ratings,
      });
      window.localStorage.setItem(chatsKey(org, site), JSON.stringify(list));
    } catch {
      // Quota or blocked storage: the live chat is unaffected, history just doesn't keep.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, chatId, org, site, branch, ratings]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    // Refresh the editor pane when a write tool completes (count completed write parts).
    const completed = completedWrites(messages);
    if (completed > seen.current) {
      seen.current = completed;
      onAgentWrite();
    }
  }, [messages, onAgentWrite]);

  const lastId = messages[messages.length - 1]?.id;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
        {view === "history" ? (
          <button
            type="button"
            onClick={() => setView("chat")}
            className="flex items-center gap-1.5 rounded-full border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-neutral-800"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </button>
        ) : (
          <button
            type="button"
            onClick={newChat}
            className="flex items-center gap-1.5 rounded-lg bg-neutral-100 px-3 py-1.5 text-sm font-medium hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700"
          >
            <Plus className="h-4 w-4" />
            New chat
          </button>
        )}
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Chat history"
            title="Chat history"
            onClick={() => {
              if (view === "history") {
                setView("chat");
              } else {
                setHistory(readHistory());
                setView("history");
              }
            }}
            className={`rounded p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
              view === "history" ? "text-[var(--violet)]" : "text-neutral-500"
            }`}
          >
            <History className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Close agent"
            onClick={onClose}
            className="rounded p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      {view === "history" ? (
        <div className="flex-1 overflow-y-auto">
          {history.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-neutral-400">No past chats on this device yet.</p>
          ) : (
            history.map((chat) => (
              <button
                key={chat.id}
                type="button"
                onClick={() => restoreChat(chat)}
                className="flex w-full items-center gap-3 border-b border-neutral-200 px-4 py-3 text-left hover:bg-neutral-100 dark:border-neutral-800 dark:hover:bg-neutral-800/60"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{chat.title}</span>
                  <span className="mt-0.5 flex items-center gap-2.5 text-xs text-neutral-400">
                    {chatAge(chat.updatedAt)}
                    {chat.branch && (
                      <span className="flex items-center gap-1">
                        <GitBranch className="h-3 w-3" />
                        {chat.branch}
                      </span>
                    )}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-neutral-400" />
              </button>
            ))
          )}
        </div>
      ) : (
        <>
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4">
            {messages.length === 0 ? (
              <p className="mx-auto max-w-[16rem] pt-8 text-center text-sm text-neutral-400">
                Ask the agent to edit your docs — e.g. “rewrite the intro” or “add an FAQ entry”.
                Attach a screenshot or a file to give it context.
              </p>
            ) : (
              <div className="space-y-4">
                {messages.map((m) => (
                  <AgentMessage
                    key={m.id}
                    role={m.role}
                    parts={m.parts as Part[]}
                    // Actions appear once the reply has settled — not under a still-streaming one.
                    actions={
                      m.role === "assistant" && !(busy && m.id === lastId)
                        ? { rating: ratings[m.id], onRate: (r) => rate(m.id, r) }
                        : null
                    }
                  />
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
            <div
              className="rounded-xl border border-neutral-300 p-2 focus-within:border-[var(--violet)] dark:border-neutral-700"
              // Dropping a file anywhere on the composer attaches it — the gesture screenshots want.
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void addFiles(e.dataTransfer.files);
              }}
            >
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pb-2">
                  {attachments.map((a, i) => (
                    <span
                      key={i}
                      className="flex items-center gap-1.5 rounded-lg border border-neutral-300 py-1 pl-1.5 pr-1 text-xs text-neutral-600 dark:border-neutral-700 dark:text-neutral-300"
                    >
                      {a.mediaType?.startsWith("image/") && a.url ? (
                        // The data URL is already in memory — showing it costs nothing and confirms
                        // the right screenshot got grabbed.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={a.url} alt="" className="h-6 w-6 rounded object-cover" />
                      ) : (
                        <FileText className="h-3.5 w-3.5 shrink-0" />
                      )}
                      <span className="max-w-[9rem] truncate">{a.filename ?? a.mediaType}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${a.filename ?? "attachment"}`}
                        onClick={() => {
                          setAttachments(attachments.filter((_, k) => k !== i));
                          setAttachError(null);
                        }}
                        className="rounded p-0.5 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex items-end gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      ask(input);
                    }
                  }}
                  // Pasting a screenshot straight from the clipboard is the whole reason this
                  // exists; text pastes fall through untouched (no files → nothing intercepted).
                  onPaste={(e) => {
                    const files = Array.from(e.clipboardData.files);
                    if (files.length > 0) {
                      e.preventDefault();
                      void addFiles(files);
                    }
                  }}
                  rows={1}
                  placeholder='Try "expand more about…"'
                  className="max-h-40 flex-1 resize-none bg-transparent py-1.5 text-sm outline-none placeholder:text-neutral-400"
                />
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  accept={ATTACHMENT_ACCEPT}
                  className="hidden"
                  onChange={(e) => {
                    void addFiles(e.target.files);
                    e.target.value = ""; // re-selecting the same file must fire change again
                  }}
                />
                <button
                  type="button"
                  aria-label="Attach a file"
                  title="Attach a file — or paste or drop one"
                  onClick={() => fileInput.current?.click()}
                  className="rounded-lg p-1.5 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                >
                  <Paperclip className="h-4 w-4" />
                </button>
                <button
                  type="submit"
                  aria-label={busy ? "Stop" : "Send"}
                  disabled={!busy && !input.trim() && attachments.length === 0}
                  className="db-cta rounded-lg p-1.5 text-white disabled:opacity-40"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
              </div>
            </div>
            {attachError && (
              <p role="alert" className="pt-1.5 text-[11px] text-red-400">
                {attachError}
              </p>
            )}
            <p className="pt-1.5 text-center text-[11px] text-neutral-400">Agent is in beta and may make mistakes.</p>
          </form>
        </>
      )}
    </div>
  );
}

function AgentMessage({
  role,
  parts,
  actions,
}: {
  role: string;
  parts: Part[];
  /** Copy/Good/Bad row under a settled assistant reply; null hides it (user msgs, streaming). */
  actions: { rating?: AgentRating; onRate: (r: AgentRating) => void } | null;
}) {
  const [copied, setCopied] = useState(false);
  if (role === "user") {
    const text = parts.filter((p) => p.type === "text").map((p) => p.text).join("");
    const files = parts.filter((p) => p.type === "file");
    return (
      <div className="ml-auto w-fit max-w-[85%] space-y-1.5">
        {files.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1.5">
            {files.map((f, i) =>
              // A chat restored from history has its attachment BYTES dropped (agent-chats.ts),
              // so an image chip falls back to the filename form when the url is gone.
              f.mediaType?.startsWith("image/") && f.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={f.url} alt={f.filename ?? "attachment"} className="max-h-28 rounded-lg" />
              ) : (
                <span
                  key={i}
                  className="flex items-center gap-1 rounded-lg bg-[color-mix(in_srgb,var(--violet)_16%,transparent)] px-2 py-1 text-xs text-[var(--fg)]"
                >
                  <FileText className="h-3 w-3" /> {f.filename ?? "attachment"}
                </span>
              ),
            )}
          </div>
        )}
        {text && (
          <div className="ml-auto w-fit rounded-2xl bg-gradient-to-br from-[var(--blue)] to-[var(--violet)] px-3 py-1.5 text-sm text-white">{text}</div>
        )}
      </div>
    );
  }
  const copyText = messageCopyText(parts);
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
            : name === "save_attachment"
              ? "Saving your image…"
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
      {actions && copyText && (
        <div className="flex items-center gap-0.5 pt-0.5">
          <button
            type="button"
            aria-label="Copy message"
            title="Copy message"
            onClick={() => {
              void navigator.clipboard?.writeText(copyText).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
            className="rounded p-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            aria-label="Good response"
            title="Good response"
            aria-pressed={actions.rating === "up"}
            onClick={() => actions.onRate("up")}
            className={`rounded p-1 ${
              actions.rating === "up"
                ? "text-[var(--violet)]"
                : "text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
            }`}
          >
            <ThumbsUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Bad response"
            title="Bad response"
            aria-pressed={actions.rating === "down"}
            onClick={() => actions.onRate("down")}
            className={`rounded p-1 ${
              actions.rating === "down"
                ? "text-[var(--violet)]"
                : "text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
            }`}
          >
            <ThumbsDown className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
