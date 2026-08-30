import { describe, it, expect } from "vitest";
import {
  authorInitials,
  contentSha,
  groupVersionsByDay,
  isNewVersion,
  versionTime,
  type VersionRow,
} from "@/lib/page-history";

const row = (over: Partial<VersionRow> & { publishedAt: Date }): VersionRow => ({
  id: "v",
  authorName: "John Lang",
  isCurrent: false,
  ...over,
});

describe("isNewVersion", () => {
  it("records the first version of a page", () => {
    expect(isNewVersion({ content: "# Hi", latestSha: null })).toBe(true);
  });

  it("skips a page the publish didn't change", () => {
    // A publish writes every file in the draft buffer, including ones opened and left alone.
    // Without this the panel fills with entries that changed nothing.
    const content = "# Hi";
    expect(isNewVersion({ content, latestSha: contentSha(content) })).toBe(false);
  });

  it("notices a change as small as trailing whitespace", () => {
    expect(isNewVersion({ content: "# Hi ", latestSha: contentSha("# Hi") })).toBe(true);
  });
});

describe("groupVersionsByDay", () => {
  const now = new Date(2026, 7, 30, 14, 0); // 30 Aug 2026, local

  it("labels the two days a reader is actually looking for", () => {
    const groups = groupVersionsByDay(
      [
        row({ publishedAt: new Date(2026, 7, 30, 9, 0) }),
        row({ publishedAt: new Date(2026, 7, 29, 20, 32) }),
      ],
      now,
    );
    expect(groups.map((g) => g.label)).toEqual(["Today", "Yesterday"]);
  });

  it("dates anything older, dropping the year when it's this year", () => {
    const groups = groupVersionsByDay([row({ publishedAt: new Date(2026, 6, 4, 12, 0) })], now);
    expect(groups[0].label).toBe("July 4");
  });

  it("keeps the year on a version from another year", () => {
    const groups = groupVersionsByDay([row({ publishedAt: new Date(2025, 6, 4, 12, 0) })], now);
    expect(groups[0].label).toBe("July 4, 2025");
  });

  it("collects same-day versions under ONE heading, in order", () => {
    const groups = groupVersionsByDay(
      [
        row({ id: "a", publishedAt: new Date(2026, 7, 30, 11, 0) }),
        row({ id: "b", publishedAt: new Date(2026, 7, 30, 9, 0) }),
        row({ id: "c", publishedAt: new Date(2026, 7, 29, 9, 0) }),
      ],
      now,
    );
    expect(groups).toHaveLength(2);
    expect(groups[0].versions.map((v) => v.id)).toEqual(["a", "b"]);
  });

  it("handles an empty history without inventing a heading", () => {
    expect(groupVersionsByDay([], now)).toEqual([]);
  });

  it("compares by local day, not by 24-hour spans", () => {
    // 00:30 today and 23:30 yesterday are an hour apart and belong under different headings.
    const groups = groupVersionsByDay(
      [
        row({ publishedAt: new Date(2026, 7, 30, 0, 30) }),
        row({ publishedAt: new Date(2026, 7, 29, 23, 30) }),
      ],
      now,
    );
    expect(groups.map((g) => g.label)).toEqual(["Today", "Yesterday"]);
  });
});

describe("authorInitials", () => {
  it("takes the first and last initial", () => {
    expect(authorInitials("John Lang")).toBe("JL");
    expect(authorInitials("Ada Byron Lovelace")).toBe("AL");
  });

  it("falls back to two letters for a single name", () => {
    expect(authorInitials("papervine")).toBe("PA");
  });

  it("never renders an empty circle", () => {
    // An automation publishes with no user behind it, so this is a real row, not a bad one.
    expect(authorInitials(null)).toBe("—");
    expect(authorInitials("   ")).toBe("—");
  });
});

describe("versionTime", () => {
  it("is the short clock time shown beside the author", () => {
    expect(versionTime(new Date(2026, 7, 29, 20, 32))).toMatch(/8:32/);
  });
});
