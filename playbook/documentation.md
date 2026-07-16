# Documentation: Two Readers, Two Documents

Every feature or behavior change is documented **twice**, because two different readers
need two different things, and one document trying to serve both serves neither.

## The design log (the *why*)

A dated, append-mostly record of decisions: what was chosen, what it was chosen over, the
trade-off accepted, the measured result, the roadmap impact. "We chose X over Y because…"
and "landed on <date>, measured <result>" live here.

Its reader is **future-you (or a future agent) about to re-litigate a decision**. The log
exists so a settled question can be answered by reading, not by re-arguing or — worse —
by silently reversing a decision whose rationale was never written down.

Keep it honest: when a decision is *reversed*, the log records the reversal and why the
original rationale no longer holds. A design log that only accretes wins is fiction.

## The evergreen reference (the *how*)

Present-tense, no dates, no history: how the system works, right now. New surface → new
page. Changed behavior → the page changes with it.

Its reader is **someone using the system today** who doesn't care what it used to do or
why it changed. Dated notes pasted into reference docs rot instantly; translate the
mechanism into timeless prose instead.

If the project can render its own docs, it should — dogfooding the reference through the
product's own pipeline makes the docs a test fixture, and a crawl of them a CI gate.

## The rule of thumb

If you wrote a design-log entry, you owe a reference edit, and vice versa. A brand-new
surface owes both. A pure internal refactor with no behavior change owes neither — a code
comment suffices.

## Comments are documentation too — the third reader

Code comments serve the reader **already inside the file**. They explain *why* —
constraints the code can't show, the non-obvious reason this isn't written the simpler
way — never *what* the next line does. A comment that restates the code is noise; a
comment that saves the next person from "simplifying" a load-bearing oddity is one of the
highest-leverage lines in the file (see `gotchas.md`).
