import { describe, it, expect } from "vitest";
import {
  NO_MEDIA,
  SLASH_ITEMS,
  filterSlashItems,
} from "@/components/editor/visual/menu-items";

// The `/` palette's item list is pure data + a filter, so the "which blocks does this editor
// offer" decision is unit-testable without a browser or an editor instance. What matters here is
// the marketing home's demo, which mounts VisualEditor with no site behind it: anything that
// reaches object storage has to be gone, and everything else has to survive.

const titles = (items: { title: string }[]) => items.map((i) => i.title);

describe("filterSlashItems", () => {
  it("returns everything for an empty query", () => {
    expect(filterSlashItems("")).toEqual(SLASH_ITEMS);
  });

  it("matches on title and on search terms", () => {
    expect(titles(filterSlashItems("callout"))).toContain("Note");
    // "img" is only a searchTerm for Image, never its title.
    expect(titles(filterSlashItems("img"))).toContain("Image");
  });
});

describe("NO_MEDIA", () => {
  it("drops exactly the items that need the media dialog", () => {
    const dropped = SLASH_ITEMS.filter((i) => !NO_MEDIA(i));
    expect(titles(dropped).sort()).toEqual(["Embed", "Image", "Video"]);
  });

  it("keeps every item that inserts without a backend", () => {
    const kept = filterSlashItems("", NO_MEDIA);
    expect(kept.every((i) => !i.input)).toBe(true);
    // Mermaid is categorised as Media but inserts a plain code block — the predicate keys on
    // `input`, not on the category, precisely so this one survives.
    expect(titles(kept)).toContain("Mermaid");
    expect(titles(kept)).toEqual(expect.arrayContaining(["Table", "Tabs", "Note", "Steps"]));
  });

  it("leaves no way to reach the dialog by searching for it", () => {
    expect(filterSlashItems("video", NO_MEDIA)).toEqual([]);
    expect(filterSlashItems("image", NO_MEDIA)).toEqual([]);
    expect(filterSlashItems("embed", NO_MEDIA)).toEqual([]);
    // The Media *category* is still reachable — via Mermaid, which is fine.
    expect(titles(filterSlashItems("mermaid", NO_MEDIA))).toEqual(["Mermaid"]);
  });

  it("still filters by query within the allowed set", () => {
    expect(titles(filterSlashItems("table", NO_MEDIA))).toContain("Table");
  });
});
