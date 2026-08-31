// The editor agent's chat history (SPEC §9.2): past conversations, kept in localStorage.
//
// localStorage, not Postgres, on purpose: a chat with the editing agent is a per-person working
// context, like an unsent draft — not site content and not team state. The drafts the agent
// WROTE are already in the draft buffer; the conversation around them is a viewer convenience,
// so it gets the browser-storage treatment (survives refreshes on this machine, never syncs,
// can vanish without breaking anything). Everything here is pure so the rules — what a chat is
// titled, what gets persisted, how the list is capped — are unit-testable without a browser.

import type { UIMessage } from "ai";

export interface StoredChat {
  id: string;
  title: string;
  updatedAt: number;
  messages: UIMessage[];
  /** The edit branch the chat happened on — display metadata for the history list. */
  branch?: string;
  /** Good/Bad ratings given to assistant messages, by message id — so a restored chat keeps them. */
  ratings?: Record<string, "up" | "down">;
}

/** Per site, not per branch: switching branches mid-thought shouldn't hide the conversation. */
export function chatsKey(org: string, site: string): string {
  return `pv-agent-chats:${org}/${site}`;
}

/** A chat is named by the first thing the user asked, trimmed to a listing-sized line. */
export function chatTitle(messages: UIMessage[]): string {
  for (const m of messages) {
    if (m.role !== "user" || !Array.isArray(m.parts)) continue;
    const text = (m.parts as { type: string; text?: string }[])
      .filter((p) => p.type === "text" && p.text)
      .map((p) => p.text)
      .join(" ")
      .trim();
    if (text) return text.length > 48 ? `${text.slice(0, 47)}…` : text;
    if ((m.parts as { type: string }[]).some((p) => p.type === "file")) return "Attachment";
  }
  return "New chat";
}

/**
 * What actually gets written to localStorage: the conversation minus attachment BYTES.
 *
 * A message can carry 3MB of data-URL file parts, and localStorage's whole budget is ~5MB —
 * two screenshots would evict every other chat. The filename and type survive (the restored
 * chat still shows what was attached); the pixels don't, and the chips render without a
 * thumbnail when the url is gone.
 */
export function compactForStorage(messages: UIMessage[]): UIMessage[] {
  return messages.map((m) => {
    if (!Array.isArray(m.parts)) return m;
    const parts = (m.parts as { type: string; url?: string }[]).map((p) =>
      p.type === "file" && p.url?.startsWith("data:") ? { ...p, url: "" } : p,
    );
    return { ...m, parts } as UIMessage;
  });
}

/**
 * The list with `chat` added or refreshed: current first, deduped by id, empty chats dropped,
 * capped so the store can't grow without bound.
 */
export function upsertChat(list: StoredChat[], chat: StoredChat, cap = 20): StoredChat[] {
  if (chat.messages.length === 0) return list;
  const rest = list.filter((c) => c.id !== chat.id);
  return [chat, ...rest].slice(0, cap);
}

/** Parse what localStorage held — corrupt or foreign values read as "no history". */
export function parseStoredChats(raw: string | null): StoredChat[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c): c is StoredChat =>
        !!c &&
        typeof (c as StoredChat).id === "string" &&
        typeof (c as StoredChat).title === "string" &&
        typeof (c as StoredChat).updatedAt === "number" &&
        Array.isArray((c as StoredChat).messages),
    );
  } catch {
    return [];
  }
}

/** "less than a minute ago", "14m ago", "3h ago", "2d ago" — enough for a history list. */
export function chatAge(updatedAt: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - updatedAt) / 1000));
  if (s < 60) return "less than a minute ago";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
