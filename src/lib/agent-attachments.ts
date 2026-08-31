// Attachments for the editor agent (SPEC §9.2): files the author hands the model as context —
// a screenshot to imitate, a CSV to turn into a table, a draft to fold in.
//
// They travel INSIDE the chat message as data-URL file parts (the AI SDK's own shape), not
// through object storage: an attachment is conversation context, not site content, so nothing
// should persist it, and inlining means the whole feature works with zero new infrastructure.
// The cost of that choice is a hard budget — the request body carries the bytes as base64, and
// Vercel caps a function's request at ~4.5MB — which is what the limits here enforce, on both
// sides: the composer refuses before sending (the error lands next to the paperclip), and the
// route refuses before spending model tokens (defense against a client that skipped the check).
//
// Pure on purpose: every rule that decides what may be attached is unit-testable with no
// browser, no route, no SDK.

import type { UIMessage } from "ai";

export const ATTACHMENT_LIMITS = {
  /** Per message. More than a few files is a sign the request wants to be a different tool. */
  maxFiles: 4,
  /** Decoded bytes per message, all files together. Base64 inflates by ~37%, and the JSON body
   *  must stay under Vercel's ~4.5MB request cap with room for the conversation itself. */
  maxTotalBytes: 3 * 1024 * 1024,
} as const;

/**
 * What the agent accepts, by media type.
 *
 * - `image`: sent to the model as-is — needs a vision-capable model (every hosted default is;
 *   a local text-only model will refuse, and that error streams back readably).
 * - `text`: inlined into the prompt as a fenced block (inlineTextAttachments), so it works on
 *   EVERY provider, including local models with no file support at all.
 * - `pdf`: passed through as a file part; Anthropic and Google read PDFs natively.
 */
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const TEXT_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "application/json",
]);
const PDF_TYPE = "application/pdf";
// SVG is both at once: an image the site can store (`save_attachment` — UPLOAD_KINDS takes .svg)
// and text the model can actually read. It goes to the MODEL as inlined source — vision APIs
// reject image/svg+xml outright, while any model can read markup — and to `save_attachment` as
// an image. Logos, the thing people attach, are usually SVGs.
const SVG_TYPE = "image/svg+xml";

/** The <input accept> string — one definition, so the picker and the validator agree. */
export const ATTACHMENT_ACCEPT = [...IMAGE_TYPES, SVG_TYPE, ...TEXT_TYPES, PDF_TYPE, ".md", ".mdx", ".txt", ".csv", ".json", ".svg"].join(",");

export function isAcceptedAttachment(mediaType: string): boolean {
  const t = mediaType.toLowerCase().split(";")[0].trim();
  return (
    IMAGE_TYPES.has(t) || TEXT_TYPES.has(t) || t === PDF_TYPE || t === SVG_TYPE || t.startsWith("text/")
  );
}

export function isTextAttachment(mediaType: string): boolean {
  const t = mediaType.toLowerCase().split(";")[0].trim();
  return TEXT_TYPES.has(t) || t === SVG_TYPE || t.startsWith("text/");
}

/** Decoded size of a data URL's payload, without decoding it. 0 for anything else. */
export function dataUrlBytes(url: string): number {
  const comma = url.indexOf(",");
  if (!url.startsWith("data:") || comma === -1) return 0;
  const meta = url.slice(0, comma);
  const payload = url.length - comma - 1;
  if (!/;base64$/i.test(meta)) return payload; // percent-encoded text data URL: close enough
  const padding = url.endsWith("==") ? 2 : url.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((payload * 3) / 4) - padding);
}

type FilePartLike = { type: string; mediaType?: string; url?: string; filename?: string };

function filePartsOf(message: { role: string; parts?: unknown }): FilePartLike[] {
  if (!Array.isArray(message.parts)) return [];
  return (message.parts as FilePartLike[]).filter((p) => p?.type === "file");
}

/**
 * The one gate, shared verbatim by the composer (before sending) and the route (before the
 * model). Checks only the LAST user message — earlier ones were validated when they were sent,
 * and revalidating history would let a limit change strand an existing conversation.
 */
export function validateAttachments(parts: FilePartLike[]): string | null {
  if (parts.length === 0) return null;
  if (parts.length > ATTACHMENT_LIMITS.maxFiles) {
    return `Up to ${ATTACHMENT_LIMITS.maxFiles} attachments per message.`;
  }
  let total = 0;
  for (const part of parts) {
    const mediaType = part.mediaType ?? "";
    if (!isAcceptedAttachment(mediaType)) {
      return `${part.filename ?? "That file"} isn't a supported attachment — images, text/Markdown/CSV/JSON, or PDF.`;
    }
    if (!part.url?.startsWith("data:")) {
      // A remote URL would make the server (or the model provider) fetch on the author's
      // behalf — an SSRF surface this feature doesn't need. Inline bytes only.
      return "Attachments must be uploaded files, not links.";
    }
    total += dataUrlBytes(part.url);
  }
  if (total > ATTACHMENT_LIMITS.maxTotalBytes) {
    const mb = (n: number) => Math.round((n / (1024 * 1024)) * 10) / 10;
    return `Attachments are ${mb(total)}MB together — the limit is ${mb(ATTACHMENT_LIMITS.maxTotalBytes)}MB per message.`;
  }
  return null;
}

/** The route's form of the gate: the last user message in the conversation. */
export function validateMessageAttachments(messages: UIMessage[]): string | null {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUser) return null;
  return validateAttachments(filePartsOf(lastUser));
}

/** Decode a text data URL (base64 or percent-encoded) to its string. */
export function textFromDataUrl(url: string): string {
  const comma = url.indexOf(",");
  if (comma === -1) return "";
  const meta = url.slice(0, comma);
  const payload = url.slice(comma + 1);
  try {
    if (/;base64$/i.test(meta)) return Buffer.from(payload, "base64").toString("utf8");
    return decodeURIComponent(payload);
  } catch {
    return "";
  }
}

/** Decode a base64 data URL's payload to bytes. Empty for anything else. */
export function bytesFromDataUrl(url: string): Uint8Array {
  const comma = url.indexOf(",");
  if (comma === -1 || !/;base64$/i.test(url.slice(0, comma))) return new Uint8Array(0);
  try {
    return new Uint8Array(Buffer.from(url.slice(comma + 1), "base64"));
  } catch {
    return new Uint8Array(0);
  }
}

export interface ImageAttachment {
  filename: string;
  mediaType: string;
  url: string;
}

/**
 * The image attachments in a conversation, NEWEST first — what the `save_attachment` tool may
 * write into the site's assets. Newest-first because the model names an attachment by filename,
 * and when two messages attached `screenshot.png` the one just sent is the one meant. Images
 * only: they're the attachment kind the site's upload pipeline accepts (UPLOAD_KINDS), and a
 * text attachment belongs in a page as text, not as a stored file.
 */
export function imageAttachmentsOf(messages: UIMessage[]): ImageAttachment[] {
  const out: ImageAttachment[] = [];
  for (const message of messages) {
    if (message.role !== "user") continue;
    for (const part of filePartsOf(message)) {
      const mediaType = (part.mediaType ?? "").toLowerCase().split(";")[0].trim();
      const savable = IMAGE_TYPES.has(mediaType) || mediaType === SVG_TYPE;
      if (!savable || !part.url?.startsWith("data:")) continue;
      out.unshift({
        filename: part.filename ?? `attachment.${mediaType.split("/")[1] ?? "png"}`,
        mediaType,
        url: part.url,
      });
    }
  }
  return out;
}

/**
 * One line per attachment in the conversation, for the system prompt: name, type, size.
 *
 * This is what makes attachments work on a TEXT-ONLY model. A provider without vision silently
 * drops image content, so the model truthfully replies "I don't see an attached image" — while
 * `save_attachment` never needed the model to SEE the image, only to know it exists and call
 * the tool by filename. The inventory tells it exactly that, whatever the model.
 */
export function attachmentInventory(messages: UIMessage[]): string[] {
  const out: string[] = [];
  for (const message of messages) {
    if (message.role !== "user") continue;
    for (const part of filePartsOf(message)) {
      if (!part.url?.startsWith("data:")) continue;
      const kb = Math.max(1, Math.round(dataUrlBytes(part.url) / 1024));
      out.push(`"${part.filename ?? "attachment"}" (${part.mediaType ?? "unknown"}, ${kb}KB)`);
    }
  }
  return out;
}

/**
 * Rewrite text-ish file parts into labeled fenced text parts, in place in the message order.
 *
 * This is what makes a .md/.csv/.json attachment work on EVERY provider: models without file
 * inputs (every local OpenAI-compatible server) never see a file part at all, and providers
 * that do support files don't spend their file pipeline on what is already text. Images and
 * PDFs pass through untouched. Applied to every user message, not just the last — history is
 * resent to the model on each turn, so an inlined attachment has to stay inlined.
 */
export function inlineTextAttachments(messages: UIMessage[]): UIMessage[] {
  return messages.map((message) => {
    if (message.role !== "user" || !Array.isArray(message.parts)) return message;
    const parts = (message.parts as FilePartLike[]).map((part) => {
      if (part?.type !== "file" || !isTextAttachment(part.mediaType ?? "")) return part;
      const body = textFromDataUrl(part.url ?? "");
      const name = part.filename ?? "attachment";
      return {
        type: "text" as const,
        text: `Attached file "${name}":\n\n\`\`\`\n${body}\n\`\`\``,
      };
    });
    return { ...message, parts } as UIMessage;
  });
}
