import { describe, it, expect } from "vitest";
import {
  isEmailish,
  isHoneypotTripped,
  normalizeEmail,
  parseWaitlistSubmission,
  WAITLIST_NOTE_MAX,
} from "@/lib/waitlist";

describe("normalizeEmail", () => {
  it("lowercases and trims, so one person is one row", () => {
    expect(normalizeEmail("  Jeff@Example.COM ")).toBe("jeff@example.com");
  });
});

describe("isEmailish", () => {
  it("accepts the addresses a stricter pattern would lose", () => {
    for (const ok of [
      "a@b.co",
      "first.last+tag@sub.example.co.uk",
      "user_name@example-host.io",
      "0@1.dev",
    ]) {
      expect(isEmailish(ok), ok).toBe(true);
    }
  });

  it("rejects the shapes that are actually typos", () => {
    for (const bad of ["", "jeff", "jeff@", "@example.com", "jeff@example", "a b@c.com"]) {
      expect(isEmailish(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it("rejects an address longer than any real one, before it reaches the DB", () => {
    expect(isEmailish(`${"a".repeat(250)}@example.com`)).toBe(false);
  });
});

describe("parseWaitlistSubmission", () => {
  it("keeps the note and the source, normalized", () => {
    const parsed = parseWaitlistSubmission({
      email: " Jeff@Example.com ",
      note: "  moving off a docs.json site  ",
      source: "/",
    });
    expect(parsed).toEqual({
      ok: true,
      value: { email: "jeff@example.com", note: "moving off a docs.json site", source: "/" },
    });
  });

  it("turns a blank note into null, so the column has one empty state", () => {
    const parsed = parseWaitlistSubmission({ email: "a@b.co", note: "   " });
    expect(parsed.ok && parsed.value.note).toBe(null);
    expect(parsed.ok && parsed.value.source).toBe(null);
  });

  it("truncates rather than rejecting an over-long note — the email is the point", () => {
    const parsed = parseWaitlistSubmission({ email: "a@b.co", note: "x".repeat(2000) });
    expect(parsed.ok && parsed.value.note?.length).toBe(WAITLIST_NOTE_MAX);
  });

  it("explains what to do when the email is missing or wrong", () => {
    expect(parseWaitlistSubmission({})).toEqual({
      ok: false,
      error: "Enter your email address.",
    });
    expect(parseWaitlistSubmission({ email: "nope" })).toEqual({
      ok: false,
      error: "That doesn't look like an email address.",
    });
  });

  it("survives a body that isn't an object at all", () => {
    for (const body of [null, undefined, "hello", 42, []]) {
      expect(parseWaitlistSubmission(body).ok).toBe(false);
    }
  });

  it("ignores non-string fields instead of coercing them", () => {
    const parsed = parseWaitlistSubmission({ email: "a@b.co", note: { evil: true }, source: 7 });
    expect(parsed.ok && parsed.value.note).toBe(null);
    expect(parsed.ok && parsed.value.source).toBe(null);
  });
});

describe("isHoneypotTripped", () => {
  it("is quiet for a real submission, which never fills the hidden field", () => {
    expect(isHoneypotTripped({ email: "a@b.co" })).toBe(false);
    expect(isHoneypotTripped({ email: "a@b.co", company: "   " })).toBe(false);
  });

  it("fires when something filled every input it found", () => {
    expect(isHoneypotTripped({ email: "a@b.co", company: "Acme" })).toBe(true);
  });
});
