import { describe, it, expect } from "vitest";
import {
  parseInviteEmails,
  MAX_INVITES_PER_SUBMIT,
} from "@/lib/invite-emails";

describe("parseInviteEmails", () => {
  it("splits on commas, spaces, newlines, and semicolons", () => {
    const r = parseInviteEmails("a@x.com, b@x.com c@x.com\nd@x.com;e@x.com");
    expect(r.emails).toEqual(["a@x.com", "b@x.com", "c@x.com", "d@x.com", "e@x.com"]);
    expect(r.invalid).toEqual([]);
  });

  it("trims, lowercases, and de-duplicates", () => {
    const r = parseInviteEmails("  Jeff@Pixwel.com ,  jeff@pixwel.com , JEFF@PIXWEL.COM ");
    expect(r.emails).toEqual(["jeff@pixwel.com"]);
  });

  it("separates invalid tokens from valid ones (reports both)", () => {
    const r = parseInviteEmails("good@x.com notanemail also@bad missing@dotcom good@x.com");
    expect(r.emails).toEqual(["good@x.com"]);
    expect(r.invalid).toEqual(["notanemail", "also@bad", "missing@dotcom"]);
  });

  it("returns empty for blank / whitespace-only input", () => {
    expect(parseInviteEmails("").emails).toEqual([]);
    expect(parseInviteEmails("   \n , ; ").emails).toEqual([]);
    // @ts-expect-error — defensive against a nullish value
    expect(parseInviteEmails(undefined).emails).toEqual([]);
  });

  it("caps at MAX_INVITES_PER_SUBMIT and flags truncation", () => {
    const many = Array.from({ length: MAX_INVITES_PER_SUBMIT + 5 }, (_, i) => `u${i}@x.com`).join(" ");
    const r = parseInviteEmails(many);
    expect(r.emails).toHaveLength(MAX_INVITES_PER_SUBMIT);
    expect(r.truncated).toBe(true);
  });

  it("does not flag truncation at or under the cap", () => {
    const r = parseInviteEmails(
      Array.from({ length: MAX_INVITES_PER_SUBMIT }, (_, i) => `u${i}@x.com`).join(","),
    );
    expect(r.emails).toHaveLength(MAX_INVITES_PER_SUBMIT);
    expect(r.truncated).toBe(false);
  });
});
