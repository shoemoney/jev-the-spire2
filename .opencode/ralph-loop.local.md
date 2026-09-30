---
active: true
iteration: 3
maxIterations: 100
---

keep playing get better every run be bol

## Progress

- iteration 0: game data extracted from the resource pack — 1,784 entities (was 159)
- iteration 1: potions reachable as a plan STEP, not only a first action
- iteration 2: two live Ascension-10 runs played end to end
- iteration 3: next — the ELITE decision. 4 of 8 runs die to an elite, usually entered low.

## Verified working in production
- memory read on 90/90 decisions, lessons served into 47, correctly withheld for 43
- safety gate firing with the last-resort loss ranking
- combat blindness: 30.8% unknown -> 2/64 partial-or-unknown in the last run
- 493 tests green, clean clone green

## Standing problem
The agent enters Elites at low HP. The route LABEL now says "Elite next, no rest before",
but nothing forces a rest first. A hard veto is unfalsifiable on this corpus — 4 of 6
elite entries were forced — so the next move must be a preference, not a filter.
