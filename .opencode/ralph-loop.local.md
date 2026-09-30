---
active: true
iteration: 5
maxIterations: 100
---

keep playing get better every run be bol

## Progress

- iteration 0: game data from the resource pack — 1,784 entities (was 159)
- iteration 1: potions reachable as a plan STEP
- iteration 2: runs at floors 6, 8, 7
- iteration 3: memory + game data + potion steps verified live
- iteration 4: the agent's OWN elite record served at the map → floor 15
- iteration 5: card rewards annotated from game data → **floor 17, THE ACT 1 BOSS**

## Results so far (this session)
floors 6 → 8 → 7 → 15 → 17. Historic best before today: 14.

Two changes produced the step changes, and both were measured, not guessed:
- iteration 4 stopped the agent walking into elites half blind
- iteration 5 gave the card-reward decision something to reason with

## The standing problem, correctly stated now
It REACHED the boss at floor 17 and lost to Lagavulin Matriarch — 140 HP, and the
agent's deck is Strike, Defend, Bash, Setup Strike, Cinder, Feel No Pain. Roughly
6 damage a turn against 140 HP. It blocked and ended turns rather than killing.

Two earlier theories of mine were measured and WRONG:
- "it walks into elites broken" — 1 of 6 elites survived, including one at 100% HP
- "it needs to bank elites for later" — the boss is 140 HP and the deck cannot kill it

The binding constraint is SCALING, not survival. Every run so far has been a
survival problem wearing a scaling problem's clothes.
