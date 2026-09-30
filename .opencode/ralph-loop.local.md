---
active: true
iteration: 61
maxIterations: 100
---

keep playing get better every run be bol

## SPLIT THE WIN RATE BY ASCENSION AND THE USELESS NUMBER BECOMES A GRADIENT
Yesterday's 86.3% pooled rate is true and useless: it moves for reasons unrelated to the policy.
Ascension now rides ON each fight, so the split is computed from the same events, not a side script.

  asc     fights  won  lost  unres   rate   boss won/lost
  A0         89    78    10      1    89%    5/10 (+1 unres)
  A3         11    10     1      0    91%    0/0
  A10        54    44    10      0    81%    0/1

**Two facts that were invisible one iteration ago and both are actionable:**
  1. A10 ORDINARY fights are 8 points worse than A0 (81% vs 89%) on monsters and elites. This is
     not a boss problem. The policy loses ~1 fight in 5 at A10 that it wins at A0, and 54 A10
     fights is a real sample — this is the single best-powered signal in the whole corpus.
  2. A10 BOSS is 0/1. Every one of the 5 boss kills is A0. There is also an A3 band I had stopped
     tracking: 11 fights at 91%, better than A0, which is worth explaining before it is dismissed.

`unknown` is its own ascension bucket, not folded into 0. A missing reading is not the easiest
difficulty, and an absent band reports a null rate rather than 0% so an empty cell can read as
either a failure or a success depending on which way you lean.

## What this is for
The loop now has a number that means something: **A10 non-boss win rate, currently 81%.** It moves
only when the policy changes, it is computed from transitions rather than inference, and it splits
by difficulty so an easy-mode win cannot flatter it. 8 points of headroom on 54 samples is the
first number here I would actually steer by.

## Loop state
544 tests green (9 fight-outcome) · sweep 4: 11/14 · game batch running
