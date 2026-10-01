---
active: true
iteration: 102
maxIterations: 100000
---

Autonomous operation. Play, measure, and improve the Slay the Spire 2 agent. Do not stop for
acknowledgement; keep the loop running and keep the batch playing. Never output the completion
promise while the loop is active.

## The plan

M1 INSTRUMENT      measurement must precede every change (mostly done)
M2 EVIDENCE        a live, comparable difficulty signal  <- the binding constraint
M3 DECISION        answer the override question and act on it
M4 READ           finish the frontier reviews and convert them
M5 HARDEN         no unmeasured change ships; failures are diagnosable

## Phase 1 - restore autonomy (this file existing is the whole mechanism)
- .opencode/ralph-loop.local.md must exist with active:true and a large maxIterations
- it was deleted in 92652bc, which is why the loop kept stopping

## Phase 2 - evidence (M2)
- Ascension 10 is the primary metric and no reachable screen sets it
- Measure and record what IS reachable so the ceiling is known rather than assumed
- Keep the run/batch alive; a run is the only input that moves anything

## Phase 3 - decision (M3)
- The A/B needs 200 armed samples; it had 25 at iteration 101
- Read with abImpact(), which reports null until the floors are cleared
- Only act when the randomised estimate clears 8 depths AND 200 samples

## Phase 4 - reviews (M4)
- 6 substantial reviews unread: deepseek findings 2-5, astra, sonnet, luna, grok, sol
- Every finding is measured for effect BEFORE a fix is written
- A finding whose effect is under a few decisions is recorded, not shipped

## Phase 5 - hardening (M5)
- No policy change without a measured effect and a test that fails before the fix
- The batch must not exit early and must own its own recovery

## Standing rules, learned the hard way
- Measure on the wire or in the log, never on a proxy or a single sample
- The corpus spans many code versions; every number names the sha that produced it
- A quiet failure is not a result. If something fails silently, find out why before writing a story
- An existing test refusing a plausible change is the system working
- Record what was NOT done and why; that is most of the value

## Loop state
590 tests green - play running - A/B accumulating - reviews 4 of 10 read
