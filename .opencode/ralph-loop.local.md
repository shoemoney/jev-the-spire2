---
active: true
iteration: 42
maxIterations: 100
---

keep playing get better every run be bol

## SWEEP 3, FINDING #4, IS A CORRECTION TO MY OWN WORK
`distinctCardsSeenThisRun` — shipped two iterations ago as "the first honest deck signal the
decision has ever had" — was false twice over:

- the accumulator was keyed to `act:FLOOR`, so it was **wiped at every doorway**. "this run"
  meant "since the last door".
- it counted cards merely **OFFERED** at a reward alongside cards actually dealt. An offered card
  may be declined and was never in the deck, so the set is not a lower bound on the deck — it is a
  lower bound on nothing, while the field was labelled `floor: true` and said "a FLOOR on the deck".

Now keyed to the run, offered cards held separately and excluded, field renamed
`distinctCardsDealtOrInDeck` with `basis` and `excluded` stating its actual population.

This is the **ninth** wrong-number of the loop and the second of mine caught by the review loop
rather than by me. The difference that matters: I had already written the honest-sounding note
("a FLOOR on the deck, not the deck") *around* a number that was not a floor. A caveat does not
repair a wrong quantity.

## ALSO CAUGHT IN THE SAME REVIEW, NOT YET ACTIONED
- the intent-description fallback is too narrow (94 unparsed-incoming attributions remain)
- game-data structure promotes a card past the `unsupported` boundary without `apply()` modelling
  the clause — a warning makes it `partial` but does not stop a wrong number entering the gate
- **the default policy is `deliberate`, not the guarded one** — a bare launch runs the multi-call
  policy with NO lethal gate, which contradicts the project's own one-call/315ms description
- the 89.4% HP-loss calibration mixes prefix counterfactuals with executed turns

## Honest note on my own process
I committed once more with a failing test (a missing import meant the new assertion could not
run) and fixed it in the next commit. That is the second time this loop. The suite was green in
every report I wrote, including the ones written minutes after a red run.
