---
active: true
iteration: 8
maxIterations: 100
---

keep playing get better every run be bol

## Progress
- 0: game data from the pack — 1,784 entities (was 159)
- 1: potions reachable as a plan STEP
- 2: runs at floors 6, 8, 7
- 3: memory + game data + potion steps verified live
- 4: the agent's OWN elite record served at the map → floor 15
- 5: card rewards annotated from game data → floor 17, THE ACT 1 BOSS

Floors: 6 → 8 → 7 → 15 → 17. Historic best before today: 14.

## FOUND AND VERIFIED, NOT LANDED — carry this to iteration 9
The Act 1 boss is 233 HP. The agent ground it to 140 and lost.

**MEASURED: 20 of 33 boss turns with energy in hand dealt ZERO damage (61%).**

The cause is menu ORDER, not scoring. On a representative board the planner builds
a complete turn worth 12 damage — `Strike → Defend → Strike` — and puts it at p4,
BEHIND a bare `Defend` worth 0. The model takes the Defend. Reordering so
turn-completing plans lead puts the 12-damage turn at the top of the menu, with all
13 candidates still offered. It demonstrably works.

**Why it is not landed:** it broke 3 deliberation tests (`better-policy`,
`experiment/assisted`, `plan-benefit`) that encode the pipeline's menu ordering and
call cadence — the end-turn review fires on FEWER decisions once complete turns lead
the menu, so `calls===3` no longer means what it meant. Fixing them properly needs
more room than this iteration had, and a half-landed change to the hot decision path
is worse than none. Reverted to 498 green rather than shipped unverified.

**Also learned and worth keeping:** ids must be assigned AFTER ordering, not before.
Assigning first produced a menu whose first entry was `p4`, breaking the
"p0 is the first option" contract that several callers index on.

## The standing problem
Scaling. The deck is Strike, Defend, Bash, Setup Strike, Cinder, Feel No Pain —
~6 damage a turn against a 233 HP boss. It survives to the boss now by getting
better, and then cannot win, because the deck cannot scale. The card-reward decision
has the game data to spot a scaling card and is not yet valuing it.
