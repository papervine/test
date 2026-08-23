import { describe, it, expect } from "vitest";
import { applyOutcome } from "@/lib/automations/apply";
import {
  runDidChangeNothing,
  runDisplayStatus,
  runResultKind,
  runStatusChipClass,
  RUN_STATUS_STYLES,
} from "@/lib/automations/run-display";

// The terminal apply decision (SPEC §10.2 in-app review). Pure — no executor/git.
describe("applyOutcome", () => {
  it("no drafts → no_changes, whatever the applyMode", () => {
    expect(applyOutcome({ applyMode: "auto", draftCount: 0 })).toBe("no_changes");
    expect(applyOutcome({ applyMode: "review", draftCount: 0 })).toBe("no_changes");
  });

  it("auto + drafts → commit straight to the deploy branch", () => {
    expect(applyOutcome({ applyMode: "auto", draftCount: 3 })).toBe("commit");
  });

  it("review + drafts → review (leave the session open for in-app review)", () => {
    expect(applyOutcome({ applyMode: "review", draftCount: 3 })).toBe("review");
  });

  it("any non-'auto' applyMode with drafts routes to review (fail safe, never auto-commit)", () => {
    expect(applyOutcome({ applyMode: "whatever", draftCount: 1 })).toBe("review");
  });
});

describe("run-display: review states", () => {
  it("review_needed reads as 'review needed' with a distinct (amber) chip", () => {
    const d = runDisplayStatus("review_needed", null, 0);
    expect(d).toBe("review needed");
    expect(runStatusChipClass(d)).toBe(RUN_STATUS_STYLES["review needed"]);
    // Must not silently fall back to the generic queued/grey chip.
    expect(runStatusChipClass(d)).not.toBe(RUN_STATUS_STYLES.queued);
  });

  it("rejected has its own registered chip style", () => {
    expect(runStatusChipClass(runDisplayStatus("rejected", null, 0))).toBe(RUN_STATUS_STYLES.rejected);
  });

  it("still reads a succeeded run with no result as 'no changes'", () => {
    expect(runDisplayStatus("succeeded", null, 0)).toBe("no changes");
  });
});

// Regression: `resultRef` was treated as a proxy for "did anything change". A Papervine-hosted
// site publishes straight to object storage (SPEC §10.11) — no commit sha, no PR URL — so its
// ref is null forever, and EVERY successful hosted publish rendered as "no changes" on a page
// that simultaneously listed the file it changed and a summary describing the edit.
describe("run-display: a hosted publish has no ref but did change things", () => {
  it("succeeded with changed files reads as succeeded, ref or no ref", () => {
    expect(runDisplayStatus("succeeded", null, 1)).toBe("succeeded");
    expect(runDisplayStatus("succeeded", "abc1234", 1)).toBe("succeeded");
  });

  it("only a run that changed NOTHING reads as 'no changes'", () => {
    expect(runDisplayStatus("succeeded", null, 0)).toBe("no changes");
    expect(runDidChangeNothing({ resultRef: null, changedFileCount: 0 })).toBe(true);
    expect(runDidChangeNothing({ resultRef: null, changedFileCount: 2 })).toBe(false);
  });

  it("a legacy row with a ref but no recorded changedFiles still reads as a real result", () => {
    // changedFiles was added after resultRef; an old Git run has a sha and an empty list.
    expect(runDisplayStatus("succeeded", "deadbee", 0)).toBe("succeeded");
    expect(runDidChangeNothing({ resultRef: "deadbee", changedFileCount: 0 })).toBe(false);
  });

  it("review_needed still wins over any of it", () => {
    expect(runDisplayStatus("review_needed", null, 3)).toBe("review needed");
    expect(runDisplayStatus("review_needed", null, 0)).toBe("review needed");
  });

  it("the chip for a hosted publish is the normal succeeded chip, not the dimmed one", () => {
    const d = runDisplayStatus("succeeded", null, 1);
    expect(runStatusChipClass(d)).toBe(RUN_STATUS_STYLES.succeeded);
    expect(runStatusChipClass(d)).not.toBe(RUN_STATUS_STYLES["no changes"]);
  });
});

// What the run detail's "Result" row says. The bug showed here too: no ref fell through to
// "No changes were needed." even when the run had published files.
describe("runResultKind", () => {
  const kind = (status: string, resultRef: string | null, changedFileCount: number) =>
    runResultKind({ status, resultRef, changedFileCount });

  it("a sha or PR URL is a linkable/quotable ref", () => {
    expect(kind("succeeded", "abc1234", 1)).toBe("ref");
    expect(kind("succeeded", "https://github.com/o/r/pull/1", 1)).toBe("ref");
  });

  it("changed files with no ref → published (the hosted case)", () => {
    expect(kind("succeeded", null, 1)).toBe("published");
  });

  it("nothing changed and no ref → none", () => {
    expect(kind("succeeded", null, 0)).toBe("none");
  });

  it("an unfinished or failed run reports no result yet", () => {
    expect(kind("running", null, 0)).toBe("pending");
    expect(kind("failed", null, 2)).toBe("pending");
    expect(kind("review_needed", null, 2)).toBe("pending");
  });
});
