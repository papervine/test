import { describe, it, expect } from "vitest";
import { parseRepoInput } from "@/lib/github";

describe("parseRepoInput", () => {
  it("parses owner/name", () => {
    expect(parseRepoInput("papervine/starter")).toEqual({ owner: "papervine", name: "starter" });
  });
  it("parses a github.com URL", () => {
    expect(parseRepoInput("https://github.com/phishy/papervine")).toEqual({
      owner: "phishy",
      name: "papervine",
    });
  });
  it("strips a trailing .git", () => {
    expect(parseRepoInput("git@github.com:phishy/papervine.git")).toEqual({
      owner: "phishy",
      name: "papervine",
    });
  });
  it("rejects garbage", () => {
    expect(parseRepoInput("not a repo")).toBeNull();
    expect(parseRepoInput("")).toBeNull();
  });
});
