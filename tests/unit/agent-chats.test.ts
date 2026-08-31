import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";

import {
  chatAge,
  chatTitle,
  chatsKey,
  compactForStorage,
  parseStoredChats,
  upsertChat,
  type StoredChat,
} from "../../src/lib/agent-chats";

// The agent panel's chat history lives in localStorage, so these rules run in the browser with
// no server to double-check them — which is exactly why they're pure and pinned here: the cap
// that keeps the store bounded, the byte-dropping that keeps two screenshots from evicting every
// other chat, and the parser that treats corrupt storage as "no history" instead of a crash.

const msg = (role: string, parts: unknown[]): UIMessage => ({ id: "m", role, parts }) as UIMessage;
const chat = (id: string, updatedAt = 0): StoredChat => ({
  id,
  title: id,
  updatedAt,
  messages: [msg("user", [{ type: "text", text: "hi" }])],
});

describe("chatTitle", () => {
  it("names a chat by the first thing the user asked, trimmed to a line", () => {
    expect(chatTitle([msg("user", [{ type: "text", text: "add an FAQ entry" }])])).toBe("add an FAQ entry");
    const long = "x".repeat(80);
    expect(chatTitle([msg("user", [{ type: "text", text: long }])])).toHaveLength(48);
  });

  it("falls back for attachment-only and empty chats", () => {
    expect(chatTitle([msg("user", [{ type: "file", filename: "logo.png" }])])).toBe("Attachment");
    expect(chatTitle([])).toBe("New chat");
  });
});

describe("compactForStorage", () => {
  it("drops attachment BYTES but keeps what the chip needs", () => {
    const [out] = compactForStorage([
      msg("user", [
        { type: "text", text: "use this" },
        { type: "file", filename: "shot.png", mediaType: "image/png", url: "data:image/png;base64,AAAA" },
      ]),
    ]);
    const parts = out.parts as { type: string; url?: string; filename?: string }[];
    expect(parts[0]).toEqual({ type: "text", text: "use this" });
    expect(parts[1]).toMatchObject({ type: "file", filename: "shot.png", mediaType: "image/png", url: "" });
  });

  it("leaves everything else byte-identical", () => {
    const messages = [msg("assistant", [{ type: "text", text: "done" }])];
    expect(compactForStorage(messages)[0]).toEqual(messages[0]);
  });
});

describe("upsertChat", () => {
  it("puts the current chat first, deduped by id", () => {
    const list = [chat("a", 1), chat("b", 2)];
    const next = upsertChat(list, chat("a", 9));
    expect(next.map((c) => c.id)).toEqual(["a", "b"]);
    expect(next[0].updatedAt).toBe(9);
  });

  it("caps the list and refuses empty chats", () => {
    const list = Array.from({ length: 20 }, (_, i) => chat(`c${i}`));
    expect(upsertChat(list, chat("new"))).toHaveLength(20);
    expect(upsertChat(list, chat("new"))[0].id).toBe("new");
    expect(upsertChat(list, { ...chat("empty"), messages: [] })).toBe(list);
  });
});

describe("parseStoredChats", () => {
  it("reads back what was written", () => {
    const list = [chat("a", 5)];
    expect(parseStoredChats(JSON.stringify(list))).toEqual(list);
  });

  it("round-trips the branch and the message ratings", () => {
    const stored = { ...chat("a", 5), branch: "main", ratings: { m1: "up" as const } };
    expect(parseStoredChats(JSON.stringify([stored]))).toEqual([stored]);
  });

  it("treats null, corrupt JSON and foreign shapes as no history", () => {
    expect(parseStoredChats(null)).toEqual([]);
    expect(parseStoredChats("{not json")).toEqual([]);
    expect(parseStoredChats(JSON.stringify({ nope: 1 }))).toEqual([]);
    expect(parseStoredChats(JSON.stringify([{ id: 1 }, chat("ok")]))).toEqual([chat("ok")]);
  });
});

describe("chatsKey + chatAge", () => {
  it("keys per site, so two sites' histories never mix", () => {
    expect(chatsKey("acme", "docs")).not.toBe(chatsKey("acme", "blog"));
  });

  it("renders ages the way a history list reads", () => {
    const now = 1_000_000_000;
    expect(chatAge(now - 5_000, now)).toBe("less than a minute ago");
    expect(chatAge(now - 14 * 60_000, now)).toBe("14m ago");
    expect(chatAge(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(chatAge(now - 2 * 86_400_000, now)).toBe("2d ago");
  });
});
