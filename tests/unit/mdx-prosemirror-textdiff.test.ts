import { describe, it, expect } from "vitest";
import { textDiff, applyTextEdit } from "@papervine/mdx-prosemirror";

// The collaboration keystone: a local edit must become the SMALLEST contiguous Y.Text splice,
// so untouched prefix/suffix (a collaborator's distant edit + cursor) survive. These assert (a)
// applying the diff reproduces the target exactly, and (b) the touched region is actually minimal
// — the diff never reaches past the changed span into shared prefix/suffix.

/** A diff is valid iff applying it to old yields new. */
function expectValid(oldStr: string, newStr: string) {
  const edit = textDiff(oldStr, newStr);
  if (oldStr === newStr) {
    expect(edit).toBeNull();
    return null;
  }
  expect(edit).not.toBeNull();
  expect(applyTextEdit(oldStr, edit!)).toBe(newStr);
  return edit!;
}

describe("textDiff reproduces the target", () => {
  const cases: Array<[string, string, string]> = [
    ["equal", "hello world", "hello world"],
    ["append", "hello", "hello world"],
    ["prepend", "world", "hello world"],
    ["insert middle", "hello world", "hello brave world"],
    ["delete middle", "hello brave world", "hello world"],
    ["replace middle", "hello brave world", "hello cruel world"],
    ["full replace", "abc", "xyz"],
    ["empty to content", "", "new content"],
    ["content to empty", "old content", ""],
    ["single char typed", "The quick fox", "The quick brown fox"],
    ["single char deleted", "colour", "color"],
    ["multiline edit", "line one\nline two\nline three", "line one\nline 2\nline three"],
    ["repeated substring", "aaa", "aaaa"],
    ["trailing newline added", "text", "text\n"],
  ];
  for (const [name, oldStr, newStr] of cases) {
    it(name, () => expectValid(oldStr, newStr));
  }
});

describe("textDiff is minimal (touches only the changed region)", () => {
  it("typing a word only edits that word's span, not the shared prefix/suffix", () => {
    const before = "The quick fox jumps";
    const after = "The quick brown fox jumps";
    const edit = textDiff(before, after)!;
    // Change starts after the shared "The quick " prefix…
    expect(edit.index).toBe("The quick ".length);
    // …removes nothing and inserts only "brown ".
    expect(edit.remove).toBe(0);
    expect(edit.insert).toBe("brown ");
  });

  it("a one-component reserialization leaves the rest of a large doc untouched", () => {
    const head = "# Big doc\n\n" + "filler paragraph.\n\n".repeat(200);
    const tail = "\n\n" + "more filler.\n\n".repeat(200);
    const before = head + "<Note>old body</Note>" + tail;
    const after = head + "<Note>new body</Note>" + tail;
    const edit = textDiff(before, after)!;
    // The splice sits entirely inside the component region — and is even tighter than the tag
    // body, since "old body" and "new body" share the " body" suffix: only "old"→"new" moves.
    expect(edit.index).toBe(head.length + "<Note>".length);
    expect(edit.remove).toBe("old".length);
    expect(edit.insert).toBe("new");
  });

  it("deletion reports a pure remove (no reinsert)", () => {
    const edit = textDiff("hello brave world", "hello world")!;
    expect(edit.insert).toBe("");
    expect(edit.remove).toBe("brave ".length);
    expect(edit.index).toBe("hello ".length);
  });
});

describe("textDiff handles unicode without corrupting", () => {
  it("round-trips an edit adjacent to a multi-byte emoji", () => {
    const before = "start 🎉 end";
    const after = "start 🎉 middle end";
    expectValid(before, after);
  });
  it("round-trips replacing an emoji", () => {
    expectValid("a 🎉 b", "a 🚀 b");
  });
});
