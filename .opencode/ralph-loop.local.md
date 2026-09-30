---
active: true
iteration: 36
maxIterations: 100
---

keep playing get better every run be bol

## LANDED — the agent is now told when it is losing the FIGHT
  turnsToLive = hp / damageTakenPerTurn
  turnsToKill = enemyHp / damageDealtPerTurn
  losing on attrition  <=>  turnsToLive < turnsToKill

Accumulated per TURN, reset per fight, keyed on act/floor/enemy-names. Reports `unknown` until two
turns are observed; reports `unknowable` with a reason on a zero rate; and never phrases
"out-lasting the enemy" as a win, because running out of turns is a loss.

Two things the build caught that the design did not:
- It was first wired inside the **card-reward** branch, where it can never fire — card rewards are
  not combat. Found by building the probe BEFORE committing to the wiring, which is the order that
  has stopped three bad fixes this session.
- The test's own base was wrong: I expected `turnsToLive` computed from the fight's true entry HP,
  when the module measures from the **first observed** turn, because HP before the first observation
  is not something the process ever saw. That is the eighth wrong-unit error of this loop, and the
  first one in a test rather than in prose.

## Status
515 tests green · 19 runs · 167 logged fights · 89% won · elite 32% · 5 boss fights, 0 kills
Server restarted with the signal live; autoplay running.
