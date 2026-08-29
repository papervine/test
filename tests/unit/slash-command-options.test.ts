import { Extension } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { SlashCommand } from "../../src/components/editor/visual/SlashCommand";

// The `/` menu's arrow/Enter navigation is wired through an extension option, and it silently
// never worked: arrows fell through to the document, which moved the caret out of the `/query`
// and closed the menu, and Enter fell through too, so items could only be picked with the mouse.
//
// The cause was `Extension.configure()`'s deep merge, and this is the layer that reproduces it —
// no editor, no browser. These tests fail the moment someone "simplifies" the option back into a
// ref box.

describe("Extension.configure option identity", () => {
  it("hands a FUNCTION option through by identity", () => {
    const onKeyDown = () => true;
    expect(SlashCommand.configure({ onKeyDown }).options.onKeyDown).toBe(onKeyDown);
  });

  it("COPIES a plain-object option — which is the whole reason onKeyDown is a function", () => {
    // configure() merges with a deep merge that recurses whenever the default and the supplied
    // value are both plain objects. A React ref is `{ current }`, so it gets copied rather than
    // passed along. Nothing errors and nothing warns — the handler is simply never seen.
    const Probe = Extension.create<{ handlerRef: { current: (() => boolean) | null } }>({
      name: "probe",
      addOptions: () => ({ handlerRef: { current: null } }),
    });

    const ref: { current: (() => boolean) | null } = { current: null };
    const configured = Probe.configure({ handlerRef: ref });
    expect(configured.options.handlerRef).not.toBe(ref);

    // And this is the shape the bug actually took. `options` is a getter that re-merges on every
    // access, so it looks fine if you read it fresh — but extension code captures it ONCE
    // (`const opts = this.options` in addProseMirrorPlugins, at editor-construction time). That
    // snapshot holds a copy made while `current` was still null, and never sees a later write.
    const snapshot = configured.options;
    ref.current = () => true;
    expect(snapshot.handlerRef.current, "a captured snapshot goes stale").toBeNull();
    expect(ref.current, "…while the ref React writes to is fine").not.toBeNull();
  });

  it("defaults onKeyDown to declining the key, so an unconfigured menu can't swallow input", () => {
    expect(SlashCommand.options.onKeyDown({} as never)).toBe(false);
  });

  it("hands allowItem through by identity too", () => {
    // Same hazard, newer option: the item-visibility predicate is read from the captured
    // `opts` snapshot inside addProseMirrorPlugins. It's a function, so the deep merge can't
    // clone it — but only as long as it stays a function (an options *object* here would be
    // silently copied, and a demo mounted with media disabled would quietly offer the media
    // items again, whose dialog has no site behind it).
    const allowItem = () => true;
    expect(SlashCommand.configure({ allowItem }).options.allowItem).toBe(allowItem);
  });

  it("defaults allowItem to offering every block", () => {
    expect(SlashCommand.options.allowItem({} as never)).toBe(true);
  });
});
