---
active: true
iteration: 12
maxIterations: 100
---

keep playing get better every run be bol

## Progress
- 0: game data from the pack — 1,784 entities (was 159)
- 1: potions reachable as a plan STEP
- 2: runs at floors 6, 8, 7
- 3: memory + game data + potion steps verified live
- 4: the agent's OWN elite record at the map → floor 15
- 5: card rewards annotated from game data → floor 17, THE ACT 1 BOSS
- 9: complete turns lead the menu
- 10: the run's own seen-card floor reaches the reward decision
- 11: waste trend measured across sessions
- 12: potion-timing failure found

## NEW FINDING — the belt was empty at the boss
The floor-17 boss run: **zero potions held during all 43 boss decisions**, and exactly ONE
potion drunk in the whole run — a Weak Potion on Corpse Slug, a floor-3 trash mob.

So the boss was not lost to unused resources; the resources were already spent two thirds of
the act earlier. This is a TIMING failure, not an availability one, and it is not what the
iteration-1 potion-step work addressed: that pass only opens the belt when a turn is already
lost, and a trash mob at floor 3 was never a lost turn.

This also retires a theory I had been carrying. The memory lesson "`end_turn` with incoming
above HP+Block, and died to it" has 8 confirmations, and it is real, but on this boss run the
deaths at 8 HP were against a 233 HP pool the deck could not chew through at ~6/turn. The
lesson is not wrong; it is not the binding constraint here.

## Still running
5-run batch on the iteration-9 reorder. Run 1 was at floor 8, an ELITE, 69/80 — entering the
elite healthy, which is exactly the behaviour iteration 4 was for.

## Open, and deliberately not claimed
- No post-reorder BOSS sample exists yet. The only boss in the corpus is pre-reorder.
- Longer energy-bearing turns can mean fuller play OR grinding a lost fight. Only the floor
  settles it.
