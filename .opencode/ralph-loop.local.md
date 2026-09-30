---
active: true
iteration: 17
maxIterations: 100
---

keep playing get better every run be bol

## MY OWN BUG, AND IT WAS AN ALARMING ONE
Iteration 16 reported "90 fights: 50 lost, 40 won — half of all fights die". **That was my
measurement bug, not a finding.** I marked a fight lost by matching the death FLOOR, and floors
repeat: one death at floor 6 had ELEVEN distinct fights sharing that floor across the log.

**The truth: 102 fights, 90 won, 12 lost — 88% won.** Not 44%. I reported a crisis that did not
exist, and it was mine.

## Fixing the bug surfaced the pattern the user saw
With the loss detection done by ORDERING rather than floor-matching:

  longest blocking streak   won   lost   win rate
  1 or none                  37     2      95%   (n=39)
  2 consecutive              33     5      87%   (n=38)
  3+ consecutive             20     5      80%   (n=25)

**Monotonic: 95% → 87% → 80%.** The observation that consecutive blocking correlates with losing
is SUPPORTED once the measurement is correct. It was invisible behind my own bad arithmetic.

Caveat, stated plainly: n=25 on the 3+ bucket. 95% vs 80% on those samples is SUGGESTIVE, not
significant. Do not build a policy on it yet — take more runs first.

## Also true and unchanged
79% of blocks were against a real incoming attack; only 13% were against nothing, which is what
the idle-turn fix addresses. Blocking is mostly justified; the STREAK is the signal, not the block.

## Where that actually points
Blocking three turns running means the fight is not being won on offence. That is the same
scaling problem as the boss, seen mid-fight: the deck cannot end things, so the fight degenerates
into attrition. The streak is a SYMPTOM of the deck, not a separate cause.
