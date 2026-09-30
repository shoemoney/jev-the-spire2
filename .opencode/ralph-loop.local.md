---
active: true
iteration: 21
maxIterations: 100
---

keep playing get better every run be bol

## THE REORDER, MEASURED ON THE BOSS
The first post-reorder boss sample exists, so this is no longer an inference.

                       pre-reorder        post-reorder
  boss                  Lagavulin 233hp    Ceremonial Beast 252hp
  decisions             43                  42
  energy wasted         61%                 39%
  DAMAGE DEALT          97                  221
  turns containing Defend 19/43            13/42
  entered the fight at  80 hp               68 hp
  boss HP removed       40%                 50%

**Damage dealt more than doubled on the same number of decisions.** The agent entered
the second boss fight with 12 LESS HP and still removed half its health bar, because
the energy it used to throw at nothing went into the boss instead.

n=1 per arm, so this is not a win-rate claim. But the MECHANISM was predicted in
advance (wasted turns), and it moved the way the mechanism says it should. That is
the strongest evidence available without a much larger sample.

## Still open
- n=1 per arm. Take more boss samples before calling the reorder a win-rate improvement.
- The boss is still not killed: 252 -> 127. The deck kills half a health bar and runs out of act.
