---
active: true
iteration: 4
maxIterations: 100
---

keep playing get better every run be bol

## Progress

- iteration 0: game data extracted from the resource pack — 1,784 entities (was 159)
- iteration 1: potions reachable as a plan STEP, not only a first action
- iteration 2: three live Ascension-10 runs — floors 6, 8, 7
- iteration 3: memory + game data + potion steps all verified live
- iteration 4: the agent's OWN elite record served at the map → **floor 15, best run ever**

## The result that matters
Previous best: floor 14. Today before iteration 4: 6, 8, 7. After: **15**.

The change was not a filter. The map already said "Elite next, no rest before" and
was walked past. What changed is that the request now carries the agent's own record:

    monster  116/127 won (91%), 21.0 HP average cost
    elite     10/26  won (38%), 30.0 HP average cost

The run entered the elite at 54/86 HP instead of 20/47, and won it.

## Standing problem
It won the elite and came out at 10 HP, then died to a monster at floor 15. HP
management ACROSS the act is the gap, not any single fight. The record is now
measured per class, so the next iteration should use it for pacing — not elites
versus monsters, but whether the belt of HP a run has left can carry the rest of
the act.
