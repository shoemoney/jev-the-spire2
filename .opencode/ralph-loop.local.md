---
active: true
iteration: 10
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
- 9: complete turns lead the menu → turn-waste 61% → 39%
- 10: the run's own seen-card floor reaches the reward decision

## Landed this iteration
The bridge sends NO deck. At a card reward the player state is exactly
`block, character, gold, hp, max_hp, max_potion_slots, potions, relics, status`.
No deck, no pile counts, no hand. So the reward decision cannot see bloat, and
Skip is the option that looks safe when you know nothing.

Measured: **Skip taken 18 of 49 rewards — 37%.**

Now `seen_cards` carries every distinct card the run has actually been shown. It
is labelled a FLOOR and never called the deck: a card never drawn is missing, so
it cannot show bloat, and it says so itself.

## Two corrections to my own earlier claims
1. "Scaling cards are offered and the agent ignores them" — WRONG. Scaling-ish
   options were offered only 2 times across 49 rewards. The pool is what it is.
2. "The agent never skips" — WRONG, that was a parse bug in my own analysis
   (`command.action` is not `skip`). It skips 37% of the time.

## Running now
A 5-run batch on the iteration-9 reorder, to get the N the last iteration said
was needed before drawing any conclusion about floors. Floors today span 6-17, so
one run settles nothing.

## The standing problem
Scaling. 233 HP boss, ~6 damage a turn. The deck cannot kill it. `seen_cards` is
the first honest signal about deck state the decision has ever had; it is a floor,
not a census, and it does not by itself make a deck scale.
