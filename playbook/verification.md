# Verification: "Working" Means Shown Working

The gap between "the diff looks right" and "the feature works" is where most regressions
live. Verification closes it with evidence, not confidence.

## A real browser, not a proxy for one

Server-side checks (curl, SSR output, DOM inspection) are necessary but not sufficient.
Whole bug classes pass every proxy and fail only in a real browser:

- **Layout bugs** — a stretched flex item, a percentage height resolving against the wrong
  ancestor — render fine in the DOM tree and wrong on screen. Screenshot the page. If the
  surface has visual modes (light/dark themes, breakpoints), screenshot each.
- **Navigation bugs** — rewrites, redirects, and client-side routing can behave
  differently for a hard request (curl) than for a soft client navigation. Click the
  actual link in the actual browser.

## Watch the console — the DOM lies by omission

A whole class of framework-correctness bug is **invisible in the DOM and in screenshots**
and shows up *only* as a console error: forbidden-timing flushes, "maximum update depth
exceeded" render loops, hydration mismatches. The page looks fine while the framework is
screaming. Some of these are worse than cosmetic — a render loop can silently corrupt
data while everything on screen looks normal.

So: every browser verification session runs **with the console open**, and any error is a
finding, not noise.

Make it durable: an e2e spec that opens the surface and **fails on any page error or
framework console.error** turns "I watched the console once" into a permanent gate.
Interactive client surfaces (editors, realtime features, anything with effects-driven
state) owe this spec by default.

## Verify the journey, not the unit

Drive the app the way a user does — seeded known account, real login, real clicks —
rather than hand-assembling state. Bugs live in the seams (auth → data → render →
navigate); unit-level verification never crosses them. Keep a seeded, idempotent,
prod-guarded dev login so this costs seconds, not minutes.

## Report what you actually did

- "Verified: opened X in the browser, did Y, saw Z, console clean" — good.
- "Tests pass" (when the change has no test exercising it) — say so explicitly.
- Anything you did not verify is **labeled unverified**. Never let silence imply
  verification; the reader will assume the strongest claim your words allow.
