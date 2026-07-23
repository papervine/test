// The terminal apply decision for an automation run (SPEC §10.2). Pure so it's unit-tested
// without the executor or git: given the automation's applyMode and how many files the agent
// buffered on its draft session, decide what happens to that session at run end.
//
//   "no_changes" — nothing buffered → discard the session, succeed with no commit.
//   "commit"     — applyMode "auto"  → publish straight to the deploy branch.
//   "review"     — applyMode "review" → leave the session open for in-app review; the run ends
//                  `review_needed`, and Accept (in the dashboard) commits it later.
export type ApplyOutcome = "no_changes" | "commit" | "review";

export function applyOutcome(input: { applyMode: string; draftCount: number }): ApplyOutcome {
  if (input.draftCount <= 0) return "no_changes";
  return input.applyMode === "auto" ? "commit" : "review";
}
