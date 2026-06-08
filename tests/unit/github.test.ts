import { describe, it, expect } from "vitest";
import { parseRepoInput } from "@/lib/github";

describe("parseRepoInput", () => {
  it("parses owner/name", () => {
    expect(parseRepoInput("papervine/starter")).toEqual({ owner: "papervine", name: "starter" });
  });
  it("parses a github.com URL", () => {
    expect(parseRepoInput("https://github.com/phishy/docbot")).toEqual({
      owner: "phishy",
      name: "docbot",
    });
  });
  it("strips a trailing .git", () => {
    expect(parseRepoInput("git@github.com:phishy/docbot.git")).toEqual({
      owner: "phishy",
      name: "docbot",
    });
  });
  it("rejects garbage", () => {
    expect(parseRepoInput("not a repo")).toBeNull();
    expect(parseRepoInput("")).toBeNull();
  });
});
