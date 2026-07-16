# The Engineering Loop

Every feature, bugfix, or behavior change runs the same loop. The project's Definition of
done is this loop's **exit criteria** — you don't leave the loop until it's met.

## 1. Clarify before building

If the request is ambiguous about scope, behavior, or trade-offs, ask the questions **up
front, batched in one round** — not one at a time mid-implementation, when each question
costs a context switch and the answers can invalidate work already done.

Don't ask what the code, the spec, or the project contract already answers — that erodes
trust in every future question. Do ask when two reasonable interpretations lead to
different designs; guessing there is how you build the wrong thing carefully.

## 2. Bugs: reproduce before fixing

Get the failure to actually happen — in a real browser, or better, as a **failing test at
the right layer**. A fix without a reproduction is a guess: you can't know you fixed the
bug, only that you changed the code near it.

The reproduction *becomes* the regression test: write it first, watch it fail, then fix,
then watch it pass. This costs nothing extra — you needed the repro anyway — and it's the
only proof the bug stays dead.

## 3. Plan the test surface with the change, not after it

Before writing code, decide which test layers the change touches (see `testing.md`).
This isn't bureaucracy — it **shapes the design**:

- Logic you know needs a unit test gets extracted as a pure function instead of being
  inlined into an effectful component.
- Code you know runs on an unauthenticated/no-database path gets its graceful fallback
  designed in, not bolted on after the gate fails.
- A surface you know needs a browser test gets stable selectors and observable state.

Testability retrofitted is always worse than testability designed.

## 4. Implement, then loop until green

Run every gate that applies: typecheck → unit → integration/smoke → **real browser with
the console open** → end-to-end. A failed gate means fix and **re-run every affected
gate**, not just the one that failed — fixes regress other gates constantly.

Keep looping. Don't hand back "this should work now" — hand back "this works, here's what
I ran." Leave the loop only when everything is green, or when genuinely blocked on input
only the requester can give (and say exactly what you need).

## 5. Loop on review until quiet

When the change ships as a merge/pull request, review is **itself a loop**, because
reviewers — especially automated ones — respond to every push:

- Fetch the open review comments. **Triage honestly:** fix what's right; reply with the
  reason to what's wrong. Never silently ignore a comment, and never apply a wrong
  suggestion just to appease a reviewer — a bad fix with an approval trail is worse than
  an open thread.
- Push the fixes, **resolve the threads you addressed** so the open count reflects
  reality, then wait for the reviewer's next pass and re-fetch.
- Exit only when a **full cycle produces zero new comments** and every remaining thread
  has an answer. Answering the first batch is the middle of review, not the end.

Match your polling cadence to the reviewer's actual response time (automated reviewers
typically take a few minutes after a push); if your tooling can schedule the cycle,
schedule it rather than hand-polling.

## 6. Document and report

Update both documentation audiences (see `documentation.md`). Then report plainly: what
you ran, what passed, what you didn't verify. Anything unverified is **labeled**
unverified — never implied to work by omission.

## The failure mode this loop exists to prevent

Declaring done off a clean typecheck and a plausible-looking diff. "Working" means a real
browser showed it working with a clean console, and the tests that would catch its
regression now exist and pass.
