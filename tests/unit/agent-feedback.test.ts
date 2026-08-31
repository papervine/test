import { describe, expect, it } from "vitest";

import { messageCopyText, parseFeedbackBody, questionBefore } from "../../src/lib/agent-feedback";

// The Good/Bad/Copy row under agent replies (SPEC §9.2). The route trusts parseFeedbackBody as
// its whole input gate, and the analytics row's `query` comes from questionBefore — so both are
// pinned here, where a malformed body or a wrong question lookup fails in milliseconds.

describe("parseFeedbackBody", () => {
  it("accepts a well-formed rating", () => {
    expect(
      parseFeedbackBody({ rating: "up", messageId: "m1", chatId: "c1", question: "add an FAQ" }),
    ).toEqual({ rating: "up", messageId: "m1", chatId: "c1", question: "add an FAQ" });
    expect(parseFeedbackBody({ rating: "down", messageId: "m1" })).toEqual({
      rating: "down",
      messageId: "m1",
      chatId: undefined,
      question: undefined,
    });
  });

  it("rejects anything malformed", () => {
    expect(parseFeedbackBody(null)).toBeNull();
    expect(parseFeedbackBody("up")).toBeNull();
    expect(parseFeedbackBody({ rating: "sideways", messageId: "m1" })).toBeNull();
    expect(parseFeedbackBody({ rating: "up" })).toBeNull();
    expect(parseFeedbackBody({ rating: "up", messageId: "" })).toBeNull();
  });

  it("trims and caps the question, and drops blank ones", () => {
    expect(parseFeedbackBody({ rating: "up", messageId: "m", question: "  hi  " })?.question).toBe("hi");
    expect(parseFeedbackBody({ rating: "up", messageId: "m", question: "   " })?.question).toBeUndefined();
    expect(
      parseFeedbackBody({ rating: "up", messageId: "m", question: "x".repeat(5000) })?.question,
    ).toHaveLength(2000);
  });
});

describe("messageCopyText", () => {
  it("joins the text parts and skips tool noise", () => {
    expect(
      messageCopyText([
        { type: "text", text: "First." },
        { type: "tool-write_page" },
        { type: "text", text: " Second. " },
        { type: "text", text: "" },
      ]),
    ).toBe("First.\n\nSecond.");
  });

  it("is empty for a reply with no text", () => {
    expect(messageCopyText([{ type: "tool-search" }])).toBe("");
  });
});

describe("questionBefore", () => {
  const msgs = [
    { id: "u1", role: "user", parts: [{ type: "text", text: "first ask" }] },
    { id: "a1", role: "assistant", parts: [{ type: "text", text: "first reply" }] },
    { id: "u2", role: "user", parts: [{ type: "text", text: "second ask" }] },
    { id: "a2", role: "assistant", parts: [{ type: "text", text: "second reply" }] },
  ];

  it("finds the user ask each reply answered", () => {
    expect(questionBefore(msgs, "a1")).toBe("first ask");
    expect(questionBefore(msgs, "a2")).toBe("second ask");
  });

  it("is undefined when nothing precedes the message", () => {
    expect(questionBefore([{ id: "a0", role: "assistant", parts: [] }], "a0")).toBeUndefined();
    expect(questionBefore(msgs, "missing")).toBe("second ask" /* whole transcript scanned */);
  });
});
