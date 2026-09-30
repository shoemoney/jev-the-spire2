---
active: true
iteration: 55
maxIterations: 100
---

keep playing get better every run be bol

## MEASURED THE KNOWLEDGE BASE'S COMPLETENESS FOR THE FIRST TIME
  cards the game HAS (from the card atlas index): 622
  present in the knowledge base              : 584  (94%)

  by character
    colorless     65/84   19 missing   <- the one real gap
    defect        91/98    7 missing
    event         20/23    3 missing
    silent        91/93    2 missing
    ironclad      88/89    1 missing
    necrobinder   92/93    1 missing
    regent        92/93    1 missing
    status        11/14    3 missing   (wither1/2/3 — a numeric-suffix naming convention, not a gap)
    curse/quest   complete

**The colorless gap is the one that matters.** Nineteen cards the agent can be handed and cannot
plan, and colorless cards are exactly the ones that arrive unannounced from pots, events and
shops. `bandage up`, `bite`, `calm`, `deep breath`, `beta`, `expunger` — none are in the
localization under those names, so this is not a matching bug to fix but something to go looking for:
either they live under a different key, or the English scan window missed a sub-block.

`status` and `event` misses are naming conventions, not missing data.

## Next concrete task
Find the nineteen colorless cards in the pack rather than adding them by hand — hand-typing a card
whose effect I cannot read is precisely the invention this project refuses.

## Loop state
535 tests green · sweep 4: 9/14 · game batch running · server up
