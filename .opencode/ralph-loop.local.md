---
active: true
iteration: 32
maxIterations: 100
---

keep playing get better every run be bol

## THE 999,999,999 IS A REAL REPORTED POOL, NOT A GLITCH
Four boss decisions, all Waterfall Giant: `hp 999999999, max_hp 999999999`. So the bridge is
reporting the boss's own maximum as a billion — not a display artefact and not a stale field.

What the agent did with it, at 20 HP:
  End turn                                forecast dmg 0  survives true
  Defend → Uppercut → Waterfall Giant     forecast dmg 15 survives false
  Uppercut → Waterfall Giant              forecast dmg 15 survives false
  End turn                                forecast dmg 0  survives false

It played normally and died. There is no "this fight is unwinnable" concept in the planner, so it
spends real decisions on a pool it cannot out-damage.

## NOT FIXING IT, DELIBERATELY
I cannot verify from here whether a billion-HP second phase is a real mechanic, a sentinel the game
uses for an invulnerable phase, or a reporting bug. Adding a "give up when the pool looks impossible"
heuristic on a number I cannot explain is exactly the speculative fix I have been burned by three
times in this loop — each one either broke three tests or crashed the decision path.

So the finding is recorded and the fix is deferred until the mechanic is known. A guard built on an
unverified rule would be the same confident-not-supported number this whole project exists to reject,
just wearing a different hat.

## The boss picture, honestly
  Lagavulin Matriarch  233 -> 140  40% removed  waste 61%  pre-reorder
  Ceremonial Beast     252 -> 127  50%          waste 39%
  Ceremonial Beast     252 ->  73  71%          waste 21%
  Vantom               173 ->  72  58%          waste 36%
  Waterfall Giant      240 ->   8   97%          then a billion-HP pool
Five boss fights, five deaths, no kill. The best run got a boss to 3% and then ran into a number it
cannot model.
