---
active: true
iteration: 83
maxIterations: 100
---

keep playing get better every run be bol

## THE DEFECT, PROVEN AND QUANTIFIED
Starting from "were the non-attack turns forced?" and following it to the end:

```
boss decisions with a usable forecast                            466
  plan names an attack : 177    of which the forecast said LETHAL:  10
  plan names NO attack : 289    of which the forecast said LETHAL:  23
```
So **92% of the agent's non-attack turns were not forced by a lethal forecast** — 266 of them. And
the cases are not marginal: `inc=21 hpLoss=9 hp=80 Defend` is 21 incoming, a forecast saying only 9
would land, and a block card anyway.

Then the question that actually matters — was a safe attack available?

```
  an ATTACKING plan the forecast said survives was ALSO on the table : 112  (42%)
  no such plan existed, defending really was the only safe option   : 154  (58%)
```

**112 times the agent was offered a demonstrably surviving attack and chose not to attack.** That is
the mechanism behind 3.0 damage per decision, and it is not caution — the forecast already cleared
the attack.

## AND THE OBVIOUS EXPLANATION IS REFUTED
Iteration 70 found the chosen candidate sits deep (p50 depth 6, p90 18, max 63), so the obvious story
was "surviving attacks are ranked late and the model walks past them". Tested directly:

  rank of the FIRST surviving attack, on the 112 declined turns
    n=112   min 1   p25 1   p50 1   p75 2   max 4
    positions 1-5: 112    6-15: 0    16+: 0

**Every single one was in the top four.** The planner already ranks a surviving attack first or
second, and the model declines it anyway. **The fix is not ordering** — I would have built a ranking
change on a refuted premise, and the only reason I did not is that the measurement was cheap enough
to run before the code was written.

So this is a SELECTION problem, not a presentation problem: the top-ranked option is a surviving
attack and the agent picks defence. The obvious next candidate explanation is that the deliberation
weights `safe` above `prog` and prefers the lower-variance plan — locally defensible, and globally
fatal against a boss that ramps. That is testable against the logged factors, and it is the next
measurement rather than a change.

## Loop state
565 tests green - 112 turns where a surviving attack was ranked first and declined - ordering
refuted, so the lever is selection, not presentation
