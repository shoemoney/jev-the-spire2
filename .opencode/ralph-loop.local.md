---
active: true
iteration: 11
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

## Measured this iteration — TURNS WITH ENERGY IN HAND THAT DEALT NOTHING
  session (oldest → newest)
    09-23 20:41   271/637 = 43%     never reached a boss
    09-30 01:45    20/ 56 = 36%     never reached a boss
    09-30 02:03    29/ 71 = 41%     20/33 = 61% at the boss, 233 → 140 HP
    09-30 02:36    43/139 = 31%     never reached a boss

All-combat waste is DOWN to 31% in the newest session, from 43% in the oldest, and the
newest session also spent 139 turns with energy in hand — it fought longest of any run,
so it is grinding rather than ending turns.

## THE HONEST GAP
**There is exactly ONE boss sample in the entire corpus and it is PRE-reorder.** The 61%
boss figure is the run that died at floor 17, and the reorder landed after it. So there is
no post-reorder boss measurement at all, and "boss waste improved" is unmeasured.

Do not read the 31% all-combat figure as a boss result. The batch now running is what
will produce a post-reorder boss sample, and until one exists the claim is:
**waste fell in combat generally; the boss question is open.**

## Also open: longer fights are not the same as better ones
The newest session spent 139 energy-bearing turns against 71 in the session before. That
can mean it is playing fuller turns, or that it is grinding a fight it cannot win. Both
read the same in this metric, and the run's floor decides which it was.
