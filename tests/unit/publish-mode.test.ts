import { describe, it, expect } from "vitest";
import { publishModeForBranch } from "../../src/lib/publish-mode";

// The editor opens on the deploy ("Default") branch (see editor/page.tsx), so the primary
// Publish action must commit straight to it — NOT open a PR from the deploy branch into
// itself (which createBranch would reject as already-existing). A working branch publishes
// as a PR. Guards the incumbent-parity rule wired into PublishButton.
describe("publishModeForBranch", () => {
  it("commits when editing the deploy branch (the default editor landing)", () => {
    expect(publishModeForBranch("main", "main")).toBe("commit");
    expect(publishModeForBranch("2.x", "2.x")).toBe("commit");
  });

  it("opens a PR from a working branch", () => {
    expect(publishModeForBranch("papervine/edit-1a2b3c4d", "main")).toBe("pr");
  });
});
