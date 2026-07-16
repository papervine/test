# The Gotcha Log: Pay for Each Lesson Once

Every project accumulates knowledge that is true, important, and **invisible in the
code**: the dependency pinned for a reason, the flag that must match in two places, the
navigation that works in curl and fails in a browser. Undocumented, each of these is
re-discovered — at full debugging cost — by every person and every agent who touches the
code after you.

The gotcha log (a "learned the hard way" section in the project contract) is where those
lessons go to be paid for exactly once.

## What qualifies

A gotcha earns its entry when all three are true:

1. **It cost real debugging time** — not a typo, but an hour-plus hole someone fell into.
2. **The cause is invisible from the failure** — the error message, the diff, or the
   symptom points somewhere other than the true cause (or nowhere at all).
3. **It will recur** — the trap is still armed: the constraint still holds, and the code
   won't stop the next person from walking into it.

Routine bugs don't qualify; their regression test is their memorial. Gotchas are the
class of problem a test alone can't fully guard — where the *next different mistake* of
the same shape needs a human (or agent) to know the underlying constraint.

## How to write one

- **Lead with the law, bold:** the one-sentence constraint ("X must match Y", "Z only
  works inside W"). A skimmer should get the rule from the bold text alone.
- **Then the mechanism:** why the constraint exists — deep enough that the reader can
  reason about novel variants, not just pattern-match the one incident.
- **Then the incident:** "this bit <feature>" — the war story that proves it's real and
  makes it memorable.
- **Name the tempting wrong fix** when there is one ("don't 'fix' this by doing X — it
  breaks Y"). The most dangerous moment for a documented gotcha is a well-meaning cleanup.

## Where it lives

In the **project contract** (the always-loaded instructions file), not in a wiki nobody
reads before coding. A gotcha's whole value is being in front of the person about to
re-trigger it. If an entry is only relevant inside one file, a *why*-comment at the trap
site is even better — closest to the blast radius (see `documentation.md`).

The log compounds: a project one year in should have a dozen entries, each representing
a debugging session nobody will ever repeat. That's the cheapest velocity you will ever
buy.
