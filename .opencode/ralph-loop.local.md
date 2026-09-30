---
active: true
iteration: 54
maxIterations: 100
---

keep playing get better every run be bol

## TWENTY-FIVE RUNS, SPLIT THE ONLY WAY THAT IS HONEST
Split by ASCENSION, because pooling them is the mistake I retracted at iteration 38.

**Ascension 10 — the only runs comparable to the historical baseline:**
  runs 1-8  (before this session's fixes)   floors 14, 9, 14, 11, 12, 6, 8, 7   median 11, best 14
  runs 9-10 (after the early fixes)         floors 15, 17                            median 16, best 17
  n=2 against n=8. Suggestive. Not a claim.

**Ascension 0 — a different difficulty, reported separately and never pooled:**
  runs 11-25   median 17, best 31 (act 2)
  **five runs reached the Act 1 BOSS at floor 17** and one cleared it into Act 2.

So the honest sentence is: at the difficulty the corpus can be compared at, the last two runs are
the two deepest, on a sample of two. At the easier setting the agent now reaches the boss routinely.
Neither number says "the fixes caused it", and the ascension-0 line is not evidence of anything on
its own.

## What is solid
- monster 547/576 (95%), elite 29/52 (56%) — elite has roughly doubled from 11/34 (32%)
- six boss fights recorded, no kill, two left the boss under 20% of its health
- 535 tests green, and the last three defects were each a signal that reached nobody

## The shape of this loop
Twenty-five runs, and the improvements were almost never "the model played better". They were:
  a regex that matched no real label; a list of eleven potion names standing in for twenty-nine; a
  signal attached to one of two code paths; a field labelled a floor that was a floor on nothing;
  a gate rescuing whichever survivor the menu happened to list first.

Not one of those is a play improvement. All five removed reasons the agent could not SEE the board,
and every measurement that followed said the same thing: it was looking at half a picture and calling
it a decision.

## Loop state
535 tests green · sweep 4: 9/14 · game batch running · server up
