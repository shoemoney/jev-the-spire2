---
active: true
iteration: 62
maxIterations: 100
---

keep playing get better every run be bol

## NAMED THE 9 A10 NON-BOSS LOSSES AND FOUND THE PATTERN — THEN CAUGHT MYSELF WRONG TWICE
Got the loss list into the module (board at death + per-fight parser coverage) instead of another
throwaway script, and broke my own analysis twice on the way, which is the argument for the module:

  1. Captured `state.battle.intents`, which does not exist. Recorded `inc=[]` on all 9 losses and
     called it a measurement. An always-empty array is the most convincing wrong number there is.
  2. Counted every non-numeric intent label as unparsed. Reported **"the agent is blind on 47% of
     all decisions, losses and wins alike"** — and it was false. 1589 of 4592 intents are
     Buff/Defend/Debuff/Summon/Stun whose label is empty BECAUSE they telegraph no damage. 895 of
     those are Buffs. Counting them made a correct screen look like a failed parse.
     Also the corpus has ZERO prose labels: every one of 4592 is a plain integer or `NxM`.

## THE REAL SIGNAL
  A10 non-boss, plain-integer Attack telegraphs the parser can read:
    losses  215/302   71.2%
    wins   1088/1251  87.0%
  multi-hit telegraph involved in a loss: 7 of 9

And the signature is exact on four of them — blindTurns == multiHit to the turn:
    Inklet                multiHit 4   blind 4/4
    Phantasmal Gardener   multiHit 22  blind 22/22
    Skulking Colony       multiHit 8   blind 8/32
    Byrdonis              multiHit 11  blind 11/24

**So the planner goes `unknown` on precisely the turns where the enemy telegraphs a multi-hit
attack** — the case where the total is `NxM (total)` and is frequently much larger than the number
on the card. The agent has been reading ~71% of A10 attack telegraphs and blind to the rest, and it
loses disproportionately on exactly those fights.

One honest exception: Gremlin Merc died with multiHit=22 and blind 0/30, so the NxM form IS parsed
sometimes. The gap is not "NxM unhandled" but "NxM handled inconsistently" — which is a narrower
and more fixable bug than the one I was about to describe. Fossil Stalker died facing a plain `14`
with no multi-hit and no blindness, so not every loss is a parse failure either.

## Next
Make the enemy-intent path parse `NxM (total)` deterministically, then re-measure this same table.
The target is wins and losses converging on one coverage number.

## Loop state
547 tests green · sweep 4: 11/14 · game batch running
