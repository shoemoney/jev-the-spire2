---
active: true
iteration: 20
maxIterations: 100
---

keep playing get better every run be bol

## LANDED — the selections buffer walked backwards
`server.mjs` stores events newest-first (`unshift`), but `selectionState` walked them in order and
`break`ed on the first non-`select_card` — which is the newest event, so it bailed immediately and
ALWAYS returned the state untouched. The bridge never echoes `is_selected` on a Deck Enchant screen
(key absent), so the agent could select forever and never satisfy "Choose 3 cards to Enchant".

That run then advanced from the overlay to **floor 17, Ceremonial Beast — the first POST-reorder
boss sample.** It died there. So the boss question is no longer unmeasured.

## LANDED — card CONDITIONS, from the user's eye
Colossus: "Gain 12 Block. You receive 50% less damage from VULNERABLE enemies this turn." The
classifier read only keywords, recorded `block`, and dropped the second sentence — which IS the card.
Measured: **6 of 9 Colossus plays had no Vulnerable enemy.** Cards now carry `requires`, and when the
board visibly fails it the offer says `conditionUnmet`. 186 entities have a condition.

## Where this points
Three of the last four fixes came from someone looking at the screen or the cards rather than from
my metrics. The metrics were not wrong, they were SHALLOW: they counted decisions, not whether the
decision was any good. A classifier that records "block" and drops "only while Vulnerable" produces
confident nonsense, and no win-rate number detects it.
