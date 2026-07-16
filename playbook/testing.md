# Testing: Route Every Change to the Tests It Owes

Regression protection is a hard requirement, not a virtue. The question is never *whether*
a change gets a test but *which layer* — and the answer is mechanical, not a judgment call.

## The layers

The classic pyramid, named generically (each project's binding maps these to concrete
commands and directories):

1. **Unit** — pure functions, no I/O, no framework. Milliseconds, runs anywhere. The
   widest layer: most logic should be reachable here.
2. **Integration / smoke** — boots the real system in its cheapest honest configuration
   (no external services it can survive without) and asserts the core contract holds:
   pages render, nothing 500s, gates redirect. Fast enough to run on every change,
   dependency-free enough to run in any CI job.
3. **End-to-end** — real browser, real services, real user journeys. The narrowest layer:
   expensive, so reserved for what genuinely needs a browser and live dependencies.

## The routing rule

**The lowest layer that can catch the regression wins.** A unit test on an extracted pure
core is worth more than an end-to-end test asserting the same fact — it's faster, runs
everywhere, and fails closer to the cause. Reach for e2e only for what genuinely needs
the full stack.

| You are… | You owe |
|---|---|
| Adding/changing pure logic (parsing, config, converters, helpers) | A unit test. Keep the helper pure; if the logic lives inside something effectful, **extract its pure core** and test that. |
| Changing user-visible system behavior (rendering, routing, content handling) | An integration/smoke case reproducing the exact shape of the behavior, in the gate that runs everywhere. |
| Adding code to a hot/universal path (every request, every render) | Proof it degrades gracefully when optional dependencies are absent — the cheapest gate must still pass. |
| Touching an authenticated or interactive surface | An e2e spec for the journey; interactive client surfaces also get a **console-clean assertion** (see `verification.md`). |
| Fixing a bug (any layer) | A regression test **at the lowest layer that reproduces it**, written failing before the fix (see `loop.md` step 2). |
| Building effectful client logic (editors, sync, realtime) | The pure decision core extracted and unit-tested; the user journey covered by e2e. |
| Changing persistent schema | A committed, versioned migration that CI applies from scratch — a broken migration must fail CI, not production. |
| Refactoring with zero behavior change | No new tests — the existing suites staying green *is* the test. |

## Patterns that make the routing possible

- **Extract the pure core.** Effectful code (components, providers, transports) is hard to
  unit-test; the *decisions* inside it usually aren't. Pull the decision logic into a pure
  function (input in, plan out) and unit-test that exhaustively; the effectful shell
  becomes thin enough that integration/e2e covers it.
- **Fixtures reproduce the actual failure shape.** When a bug came from real-world input,
  the test fixture is that input's shape — not a sanitized approximation that would have
  passed anyway.
- **Deterministic > networked.** Tag or gate tests that hit external networks or optional
  services so the default suite is deterministic; specs needing an optional dependency
  skip themselves loudly when it's absent rather than failing mysteriously.
- **Two-speed CI.** A fast job with zero service dependencies (types, unit, build, smoke)
  that runs everywhere, and a full job with real services for e2e. Both stay green; a red
  main is an emergency, not a baseline.

## What a test is for

A test pins **behavior someone relies on**, at the moment you understand it best. It is
cheap insurance written by the one person who currently knows the failure shape — you,
right now. Six months later, nobody will know it; the test will.
