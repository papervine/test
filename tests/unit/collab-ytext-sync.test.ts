import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { textDiff } from "@papervine/mdx-prosemirror";

// The collaboration invariant behind Phase 3: a pane pushes a whole new document string, but we
// splice only the MINIMAL changed range into the shared Y.Text (never a whole-doc replace). This
// mirrors useCollabDoc's binding.setText. These tests prove why that matters — two tabs editing
// DIFFERENT regions concurrently both keep their edits after a CRDT merge, which a full-text
// replace would clobber.

/** Mirror of binding.setText: turn a full-string update into a surgical Y.Text splice. */
function spliceTo(ytext: Y.Text, next: string) {
  const edit = textDiff(ytext.toString(), next);
  if (!edit) return;
  ytext.doc!.transact(() => {
    if (edit.remove) ytext.delete(edit.index, edit.remove);
    if (edit.insert) ytext.insert(edit.index, edit.insert);
  });
}

/** Exchange state both ways, as two BroadcastChannel peers would. */
function sync(a: Y.Doc, b: Y.Doc) {
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
}

function twoTabs(seed: string) {
  const a = new Y.Doc();
  const b = new Y.Doc();
  const ta = a.getText("mdx");
  ta.insert(0, seed);
  sync(a, b); // b adopts a's state (the "later tab joins" path)
  return { a, b, ta, tb: b.getText("mdx") };
}

describe("Y.Text collaboration via minimal-diff splices", () => {
  it("a local splice propagates to the peer verbatim", () => {
    const { a, b, ta, tb } = twoTabs("# Title\n\nHello world.\n");
    spliceTo(ta, "# Title\n\nHello brave world.\n");
    sync(a, b);
    expect(tb.toString()).toBe("# Title\n\nHello brave world.\n");
  });

  it("concurrent edits to DIFFERENT regions both survive the merge", () => {
    const { a, b, ta, tb } = twoTabs("Hello world");
    // Tab A edits the start, tab B edits the end — before either has synced.
    spliceTo(ta, "HELLO world");
    spliceTo(tb, "Hello WORLD");
    sync(a, b);
    // Both edits are preserved because each splice touched only its own region.
    expect(ta.toString()).toBe("HELLO WORLD");
    expect(tb.toString()).toBe("HELLO WORLD");
  });

  it("a peer's insertion is not lost when the other tab also edits elsewhere", () => {
    const { a, b, ta, tb } = twoTabs("intro\n\noutro\n");
    spliceTo(ta, "intro\n\nMIDDLE\n\noutro\n"); // A inserts a middle paragraph
    spliceTo(tb, "INTRO\n\noutro\n"); // B rewrites the intro
    sync(a, b);
    const merged = ta.toString();
    expect(merged).toBe(tb.toString()); // converged
    expect(merged).toContain("MIDDLE"); // A's insert kept
    expect(merged).toContain("INTRO"); // B's edit kept
  });

  it("unknown/custom MDX is just text — it round-trips through the shared doc untouched", () => {
    const seed = 'intro\n\n<CustomWidget foo={bar} count={3}>\n  body\n</CustomWidget>\n';
    const { a, b, ta, tb } = twoTabs(seed);
    // Editing far from the custom block leaves its verbatim bytes intact on the peer.
    spliceTo(ta, "INTRO\n\n" + seed.slice("intro\n\n".length));
    sync(a, b);
    expect(tb.toString()).toContain("<CustomWidget foo={bar} count={3}>");
  });
});
