---
active: true
iteration: 96
maxIterations: 100
---

keep playing get better every run be bol

## THE REVIEW FOUND A REAL HAZARD, AND ITS FIX WOULD HAVE DISABLED THE SAFETY GATE
One of the 14 reviews I asked for in the 60s and never read (qwen3.8-omni-flash, 16.6 KB) found
this, and it is the best-grounded finding any review has produced this session because it cites the
log's own calibration rather than reasoning about code.

**The claim, verified.** `lethal-gate.mjs` says in its own comment that the `true` direction requires
a FULLY STATED quality, and the code did not enforce it — `STATED_QUALITIES` contains `partial`.
`planner.mjs` sets `quality: uncertain ? 'unknown' : warnings.length ? 'partial' : 'calculated'`, so
`partial` means "carries warnings" by construction. In the corpus:

    partial forecasts executed                     3332
      claiming survives:true                        3246   (97.4%)
      AND carrying an Unmodeled relic/power warning  3246   (100% of those)

A visible power or relic the simulation omitted was deciding that the agent survives, on nearly
every executed decision. The review's calibration backs it: the largest forecast errors in the corpus
are `partial` rows (predicted 28, actual -15, over by 43 HP), while `incomingIsBound` — the stated
reason `partial` was ever admitted here — appears on 3 of 824 combat decisions. **The justification
and the code had drifted apart, and the code was the permissive one.**

**I implemented the fix. It broke five tests, and the tests were right.**
Restricting the survival direction to `calculated`/`exact` looks obviously correct. It is a
disaster:

    executed forecast qualities, whole corpus
      partial      3332  66.6%
      none         1388  27.8%
      unknown       210   4.2%
      calculated     71   1.4%

**`calculated` happens on 1.4% of decisions.** The test that caught it says it plainly: the old rule
required `calculated` on both sides, and across a recorded run there were 359 `partial`, 160
`unknown` and **not one `calculated`** — "it read as a safety net and was not one." Requiring it now
would leave the gate able to identify a survivor on 71 decisions out of 5,001 and inert on the rest.
That is a catastrophic regression wearing the exact costume of a safety fix. **Reverted.**

## THE ACTUAL DEFECT IS UPSTREAM, AND IT IS WORSE THAN THE ONE REPORTED
The vocabulary has collapsed. `Unmodeled relic` appears on essentially every combat decision, so
"has warnings" is nearly always true, so `partial` no longer distinguishes *"an irrelevant relic is
unmodeled"* from *"a power that changes incoming damage is unmodeled."* **The quality field is not
carrying information, and every consumer of it — including the gate — is reading noise.**

The reviewer's own first suggestion is the right layer and the necessary one: classify unmodeled
effects by whether they can change survival, and only then degrade the forecast's completeness. That
makes `calculated` reachable again, and only after that does tightening `statedSurvival` mean
anything. **The order is not interchangeable, and taking it in the wrong order is what I nearly
shipped.**

## Why this is the most useful review of the session
It found a real hazard, it was grounded in logged data rather than inference, and its proposed remedy
was wrong in a way that would have been invisible without an existing test. A review that finds a real
problem and a fix that breaks the thing it was protecting is worth more than one that finds nothing,
because the finding survives and the fix does not.

## Loop state
581 tests green - gate reverted, hazard confirmed and recorded, upstream fix identified as the real
one - GAME STILL PARKED ON A MENU WITH NO OPTIONS, click required
