---
active: true
iteration: 66
maxIterations: 100
---

keep playing get better every run be bol

## THE LAST MEASUREMENT DEFECT: A SUM CANNOT TELL A HIT FROM A DEPARTURE
Iteration 65 left `perTurnDealt` running high because `nowEnemyHp` summed LIVE enemies, so an
enemy leaving the set dropped the sum with no damage dealt. Now tracked per `entity_id`:

  live: turns 5  dealt 24  taken 39  perTurnDealt 4.8  losing-on-attrition
  check: startEnemyHp 85 - lastEnemyHp 67 = 18, plus 6 for an enemy no longer standing = 24

The 6 is a small enemy that was killed, and hitting a 6-HP enemy IS damage dealt — so the figure
is now the true HP reduction across entities rather than a sum that moved for two different reasons.
It was 24 while the sum-based reading said 18, and it was 18-vs-12 before that.

**The bound, stated rather than hidden.** The raw state carries no flag separating a kill from a
departure, so a vanished entity contributes its full remaining HP to `dealt`. A kill is
overwhelmingly the case and this makes the figure an UPPER bound. Dropping the entity instead
would be a LOWER bound — wrong in the same direction, with no reason given why, and no way to tell
the two apart later. An unexplained asymmetric guess is worse than a labelled one.

The fight this landed in is a good demonstration that the signal now works at all: the agent is
losing on attrition in a long fight, having dealt 24 and taken 39. Under the old code this read as
`out-lasting-the-enemy`.

## What the last three iterations actually amount to
The attrition signal was unmeasurable, then wrong in three separate ways, then unlogged, and each
fix was caught by the previous fix being made visible. Nothing here came from reasoning about the
code — every one of the four bugs was found by putting a number on live data and refusing to accept
it. `dealt: 0` on a fight that visibly went 34 -> 28 was the tell, and it only existed because the
value had been written to the log.

## Loop state
555 tests green · stamping live · attrition fully observed, per-entity, and bounded
