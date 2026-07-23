import { describe, it, expect } from "vitest";
import { applyOutcome } from "@/lib/automations/apply";
import {
  runDisplayStatus,
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
    const d = runDisplayStatus("review_needed", null);
    expect(d).toBe("review needed");
    expect(runStatusChipClass(d)).toBe(RUN_STATUS_STYLES["review needed"]);
    // Must not silently fall back to the generic queued/grey chip.
    expect(runStatusChipClass(d)).not.toBe(RUN_STATUS_STYLES.queued);
  });

  it("rejected has its own registered chip style", () => {
    expect(runStatusChipClass(runDisplayStatus("rejected", null))).toBe(RUN_STATUS_STYLES.rejected);
  });

  it("still reads a succeeded run with no result as 'no changes'", () => {
    expect(runDisplayStatus("succeeded", null)).toBe("no changes");
  });
});
