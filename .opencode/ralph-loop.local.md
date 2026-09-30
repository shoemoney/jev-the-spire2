---
active: true
iteration: 34
maxIterations: 100
---

keep playing get better every run be bol

## THE 18 LOST FIGHTS, LOOKED AT PROPERLY
  108 won · 18 lost   (monster 6, elite 7, boss 5)
  lost fights entered at **53 HP** average
  **forecast said survives:false within the first 3 decisions: 0 of 18**
  decisions spent in a KNOWN-lethal state: 66 of 582 (11%)
  longest fight among the losses: 67 decisions

**In every single lost fight the agent was never told, early, that it was losing.** Zero of 18 had a
lethal verdict in their first three decisions. The forecast is `partial` almost everywhere — its
warnings are about an unmoded clause, not about accumulating danger — so it says "survives: true"
right up until the turn it cannot survive, and then it is too late to matter.

That is a much more precise statement of the failure than "the deck is weak": the agent loses fights
it is never warned about, so it plays every turn as though the fight were fine. It is the same class
as every other bug this loop has found — a number that is technically correct and practically
misleading, because it is a per-turn verdict and the danger is cumulative.

## NOT FIXING IT THIS ITERATION
A "danger accumulates" signal is exactly the kind of heuristic I have been burned by building on
unverified ground, and unlike the billion-HP pool this one I CAN reason about from the data — but
the right shape of it (per-turn slope? HP-per-turn trend? encounter-relative?) is a real design
decision, not a patch. It gets its own iteration with a plan, not a rushed edit.

Also corrected my own analysis twice in one sitting: a first pass reported "126 lost fights" and a
second "0/18" on a polluted list. Both were my grouping, and both were caught by re-running the
verified tool rather than by reading the output carefully. Fifth and sixth corrections of this shape.
