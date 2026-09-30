---
active: true
iteration: 51
maxIterations: 100
---

keep playing get better every run be bol

## I PROMISED A MEASUREMENT BEFORE BUILDING THE GRADED TREATMENT. HERE IT IS, AND IT SAYS DON'T.
  logged boards with >=2 candidates and at least one survivor : 2191
    a CALCULATED and a PARTIAL survivor both present          : 5  (0.2%)
    only a calculated survivor                              : 45
    only a partial survivor                                : 2141  (98%)
    no survivor at all, gate already silent                 : 162

Grading a survivor by forecast quality would change **5 boards out of 2191**. On 98% of boards the
only survivors are partial, so there is nothing to prefer them over.

**So the principled fix is not worth the risk.** The inconsistency is real — a `partial` is the same
species of incomplete estimate as a bound, and I wrote the rule that a bound must never prove safety
— but fixing it would add scoring complexity to the hot path for a 0.2% effect, and every scoring
change I have rushed in this loop has broken something. Building it would have been me preferring the
shape of the argument to its measured effect.

The principle stays recorded, the code stays as it is, and the honest summary is:
**correct in principle, unmeasurable in practice, deliberately not built.**

## That is the third finding this loop that did not survive a measurement
1. waste at 1.0 "can outvote survival" — built the cases, the safer plan won every one
2. the graded survival treatment — measured, affects 0.2% of boards
3. (earlier) two of Opus's five findings were about code the review packet did not contain

A review finding is a hypothesis. Testing it costs a turn; shipping it costs a day. The two this
loop has found real — the 18 invisible potion types, and attrition reaching nothing — were both
confirmed by a CONSTRUCTED CASE before any code was written. That order is the part worth keeping.

## Loop state
528 tests green · sweep 4: 6/14 · game batch running · server up on :4317
