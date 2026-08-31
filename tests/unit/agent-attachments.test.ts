import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";

import {
  ATTACHMENT_LIMITS,
  attachmentInventory,
  bytesFromDataUrl,
  dataUrlBytes,
  imageAttachmentsOf,
  inlineTextAttachments,
  isAcceptedAttachment,
  textFromDataUrl,
  validateAttachments,
  validateMessageAttachments,
} from "../../src/lib/agent-attachments";

// The editor agent's attachments travel inline as data-URL file parts, so the limits ARE the
// feature's safety: the request body has to stay under the platform's request cap, nothing may
// make the server fetch a URL on the author's behalf, and a text file has to reach every model
// as text. All of that is decided here, in pure functions, which is why it's pinned here.

const dataUrl = (bytes: number, mediaType = "image/png") =>
  `data:${mediaType};base64,${Buffer.alloc(bytes, 7).toString("base64")}`;

const filePart = (over: Partial<{ mediaType: string; url: string; filename: string }> = {}) => ({
  type: "file",
  mediaType: "image/png",
  url: dataUrl(100),
  filename: "shot.png",
  ...over,
});

describe("dataUrlBytes", () => {
  it("reports the DECODED size, not the base64 length", () => {
    for (const n of [1, 2, 3, 100, 4096]) {
      expect(dataUrlBytes(dataUrl(n))).toBe(n);
    }
  });

  it("is zero for anything that isn't a data URL", () => {
    expect(dataUrlBytes("https://example.com/x.png")).toBe(0);
    expect(dataUrlBytes("")).toBe(0);
  });
});

describe("validateAttachments", () => {
  it("accepts a normal message: a screenshot and a markdown file", () => {
    expect(
      validateAttachments([
        filePart(),
        filePart({ mediaType: "text/markdown", filename: "draft.md", url: dataUrl(50, "text/markdown") }),
      ]),
    ).toBeNull();
  });

  it("refuses more files than the cap", () => {
    const parts = Array.from({ length: ATTACHMENT_LIMITS.maxFiles + 1 }, () => filePart());
    expect(validateAttachments(parts)).toContain(`${ATTACHMENT_LIMITS.maxFiles}`);
  });

  it("refuses a type the agent can't use, naming the file", () => {
    const err = validateAttachments([filePart({ mediaType: "video/mp4", filename: "demo.mp4" })]);
    expect(err).toContain("demo.mp4");
  });

  it("refuses remote URLs — inline bytes only, so nothing fetches on the author's behalf", () => {
    const err = validateAttachments([filePart({ url: "https://evil.example/internal.png" })]);
    expect(err).toContain("uploaded files");
  });

  it("enforces the total size budget across all files together", () => {
    const half = Math.ceil(ATTACHMENT_LIMITS.maxTotalBytes / 2) + 1024;
    expect(validateAttachments([filePart({ url: dataUrl(half) })])).toBeNull();
    expect(
      validateAttachments([filePart({ url: dataUrl(half) }), filePart({ url: dataUrl(half) })]),
    ).toContain("limit");
  });
});

describe("validateMessageAttachments", () => {
  const msg = (role: string, parts: unknown[]) => ({ id: "x", role, parts }) as UIMessage;

  it("gates only the LAST user message — history was validated when it was sent", () => {
    const oversized = filePart({ url: dataUrl(ATTACHMENT_LIMITS.maxTotalBytes + 1024) });
    expect(
      validateMessageAttachments([
        msg("user", [oversized]), // grandfathered history
        msg("assistant", [{ type: "text", text: "done" }]),
        msg("user", [{ type: "text", text: "next" }, filePart()]),
      ]),
    ).toBeNull();
    expect(validateMessageAttachments([msg("user", [oversized])])).toContain("limit");
  });

  it("passes a conversation with no attachments untouched", () => {
    expect(validateMessageAttachments([msg("user", [{ type: "text", text: "hi" }])])).toBeNull();
  });
});

describe("inlineTextAttachments", () => {
  const textUrl = (s: string, mediaType = "text/markdown") =>
    `data:${mediaType};base64,${Buffer.from(s, "utf8").toString("base64")}`;

  it("turns a text file into a labeled fenced text part, in place", () => {
    const messages = [
      {
        id: "m1",
        role: "user",
        parts: [
          { type: "text", text: "fold this in" },
          { type: "file", mediaType: "text/markdown", filename: "notes.md", url: textUrl("# Notes\nhello") },
        ],
      },
    ] as unknown as UIMessage[];
    const [out] = inlineTextAttachments(messages);
    const parts = out.parts as { type: string; text?: string }[];
    expect(parts[0]).toEqual({ type: "text", text: "fold this in" });
    expect(parts[1].type).toBe("text");
    expect(parts[1].text).toContain('Attached file "notes.md"');
    expect(parts[1].text).toContain("# Notes\nhello");
  });

  it("leaves images and PDFs as file parts — the vision pipeline wants them whole", () => {
    const messages = [
      {
        id: "m1",
        role: "user",
        parts: [filePart(), filePart({ mediaType: "application/pdf", filename: "spec.pdf" })],
      },
    ] as unknown as UIMessage[];
    const [out] = inlineTextAttachments(messages);
    expect((out.parts as { type: string }[]).map((p) => p.type)).toEqual(["file", "file"]);
  });

  it("rewrites EVERY user message, because history is resent to the model each turn", () => {
    const messages = [
      { id: "a", role: "user", parts: [{ type: "file", mediaType: "text/plain", filename: "1.txt", url: textUrl("one", "text/plain") }] },
      { id: "b", role: "assistant", parts: [{ type: "text", text: "ok" }] },
      { id: "c", role: "user", parts: [{ type: "file", mediaType: "text/csv", filename: "2.csv", url: textUrl("x,y", "text/csv") }] },
    ] as unknown as UIMessage[];
    const out = inlineTextAttachments(messages);
    expect((out[0].parts as { type: string }[])[0].type).toBe("text");
    expect(out[1]).toBe(messages[1]); // assistant messages untouched, by identity
    expect((out[2].parts as { type: string }[])[0].type).toBe("text");
  });
});

describe("imageAttachmentsOf + bytesFromDataUrl (what save_attachment may store)", () => {
  const msg = (role: string, parts: unknown[]) => ({ id: "x", role, parts }) as UIMessage;

  it("collects only images with inline bytes, NEWEST first — a repeated filename means the latest one", () => {
    const older = filePart({ filename: "shot.png", url: dataUrl(10) });
    const newer = filePart({ filename: "shot.png", url: dataUrl(20) });
    const out = imageAttachmentsOf([
      msg("user", [older, filePart({ mediaType: "text/markdown", filename: "notes.md" })]),
      msg("assistant", [{ type: "text", text: "ok" }]),
      msg("user", [newer, filePart({ url: "https://remote.example/x.png" })]),
    ]);
    expect(out.map((a) => a.filename)).toEqual(["shot.png", "shot.png"]);
    expect(bytesFromDataUrl(out[0].url).length).toBe(20); // the newer one leads
    expect(out.every((a) => a.url.startsWith("data:"))).toBe(true);
  });

  it("names a nameless image after its type, so the tool can still address it", () => {
    const [a] = imageAttachmentsOf([msg("user", [filePart({ filename: undefined as never })])]);
    expect(a.filename).toBe("attachment.png");
  });

  it("decodes base64 bytes exactly, and refuses non-base64 payloads with empty bytes", () => {
    const bytes = bytesFromDataUrl(dataUrl(1234));
    expect(bytes.length).toBe(1234);
    expect(bytes[0]).toBe(7);
    expect(bytesFromDataUrl("data:text/plain,hello").length).toBe(0);
    expect(bytesFromDataUrl("https://x.example/a.png").length).toBe(0);
  });
});

describe("SVG — an image the site can store, text the model can read", () => {
  const svg = `data:image/svg+xml;base64,${Buffer.from("<svg><circle r='4'/></svg>").toString("base64")}`;
  const part = { type: "file", mediaType: "image/svg+xml", filename: "logo.svg", url: svg };
  const msg = { id: "m", role: "user", parts: [part] } as unknown as UIMessage;

  it("is accepted, and validates like any attachment", () => {
    expect(isAcceptedAttachment("image/svg+xml")).toBe(true);
    expect(validateAttachments([part])).toBeNull();
  });

  it("is savable by save_attachment (imageAttachmentsOf lists it)", () => {
    expect(imageAttachmentsOf([msg]).map((a) => a.filename)).toEqual(["logo.svg"]);
  });

  it("reaches the model as its SOURCE, not as an image part vision APIs reject", () => {
    const [out] = inlineTextAttachments([msg]);
    const first = (out.parts as { type: string; text?: string }[])[0];
    expect(first.type).toBe("text");
    expect(first.text).toContain("<svg><circle r='4'/></svg>");
  });
});

describe("attachmentInventory — what a text-only model gets instead of pixels", () => {
  it("lists every attachment with name, type and size", () => {
    const messages = [
      {
        id: "a",
        role: "user",
        parts: [
          { type: "text", text: "add this" },
          filePart({ filename: "logo.png", url: dataUrl(2048) }),
        ],
      },
      { id: "b", role: "assistant", parts: [{ type: "text", text: "ok" }] },
      {
        id: "c",
        role: "user",
        parts: [filePart({ mediaType: "text/markdown", filename: "notes.md", url: dataUrl(100, "text/markdown") })],
      },
    ] as unknown as UIMessage[];
    expect(attachmentInventory(messages)).toEqual([
      '"logo.png" (image/png, 2KB)',
      '"notes.md" (text/markdown, 1KB)',
    ]);
  });

  it("is empty when nothing is attached, so the prompt gains no attachment clause", () => {
    expect(
      attachmentInventory([{ id: "a", role: "user", parts: [{ type: "text", text: "hi" }] }] as unknown as UIMessage[]),
    ).toEqual([]);
  });
});

describe("type acceptance", () => {
  it("accepts the documented set and any text/*, refuses the rest", () => {
    for (const t of ["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf", "text/markdown", "text/x-python", "application/json"]) {
      expect(isAcceptedAttachment(t), t).toBe(true);
    }
    for (const t of ["video/mp4", "application/zip", "application/octet-stream", ""]) {
      expect(isAcceptedAttachment(t), t).toBe(false);
    }
  });

  it("round-trips text through a data URL, both encodings", () => {
    const s = "héllo → world";
    expect(textFromDataUrl(`data:text/plain;base64,${Buffer.from(s).toString("base64")}`)).toBe(s);
    expect(textFromDataUrl(`data:text/plain,${encodeURIComponent(s)}`)).toBe(s);
  });
});
