---
active: true
iteration: 45
maxIterations: 100
---

keep playing get better every run be bol

## LANDED — the lower bound, which is the signal I had been describing for four iterations
Sweep 3's Opus review found it concretely. When any attack intent is unread,
`displayed_incoming_attack_total` is null, and a null incoming makes the forecast say
"you survive." Technically true — an unread attack is not a KNOWN attack — and
practically the opposite, because the readable ones are still coming.

    both readable   total=21   lower bound=21
    ONE unread      total=null lower bound=12   <-- the case that matters
    all unread      total=null lower bound=0    <-- nothing readable, no guess

`low` was already computed and thrown away whenever anything was unread. It is a floor
on the damage this turn takes, it is exact when everything reads, and when the floor alone
exceeds HP plus block the unread intents cannot rescue the turn — they can only add.

This is the arithmetic behind "0 of 18 lost fights were warned early." The bound is
published in `factsFor` and carried as `displayed_block_gap_lower_bound`; the exact
`displayed_block_gap` stays null where it is unknown, because the bound is ADDITIONAL
evidence and must not replace the whole thing dressed up as it.

## Also from the same review, banked and not yet actioned
- model Thorns in `retaliationRule` (the module already exists to apply it)
- a kill removes the attacker's intent, so a lethal-on-paper plan that kills the only
  attacker should be reclassified as a survivor rather than pushed down the loss path
- `refuseLethalChoice` should prefer a `draw`-boundary plan over a stated-death plan:
  unknown is strictly better than stated death
- the 89.4% calibration still mixes prefix counterfactuals with executed turns

## Live
518 tests green · 5/14 sweep-3 reviews · server restarted with the bound · ascension-0 run going
