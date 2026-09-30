---
active: true
iteration: 58
maxIterations: 100
---

keep playing get better every run be bol

## THE RESIDUAL GAP I DESCRIBED LAST ITERATION HAS NEVER OCCURRED
  decisions logging a factorFallback   : 2489
    the fallback actually fired        : 0   (0.0%)
    lethal gate overrode on it         : 0
  => the gap applies to ZERO decisions in the entire corpus.

Last iteration I wrote: *"a plan that wastes but survives passes unchecked on the fallback. That is
real."* It is real **in theory and empty in practice.** The model answers every factor set on every one
of 2,489 logged decisions, so the fallback is a defensive branch that has never executed.

So there is nothing to build, and the honest summary is: **a reviewer found a real mechanism behind
a path the agent has never taken.** Three findings now stand as measured-and-not-built:
  the waste veto outvoting survival   — the safer plan won every case
  the graded survival treatment       — would change 5 boards in 2191
  the fallback bypassing the veto      — the fallback fires on 0 boards

**What that pattern is worth.** Each of the three is a genuine hole in the code and none of them is a
hole in the agent's behaviour. A review that reads code finds reachable-in-principle paths; it cannot
tell whether the agent ever goes there. The corpus can, immediately, and for free. So the loop's real
instrument is not the review at all — it is **the log, queried before the fix is written.** That is
cheaper than a code change, and it is what has caught every false positive since I started asking.

I should have measured this one before describing the gap, not after.

## Loop state
535 tests green · sweep 4: 10/14 · game batch running · server up
