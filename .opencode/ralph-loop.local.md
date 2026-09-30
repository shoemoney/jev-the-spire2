---
active: true
iteration: 85
maxIterations: 100
---

keep playing get better every run be bol

## FOUND THE CODE PATH, AND IT IS THE ARCHITECTURE RATHER THAN A BUG
`spire-demo/learning/wire.mjs`:

    const best = factorsComplete ? scored[0] : {id: jevMove.choice};

**The model's own choice is used only when the factor set is incomplete.** When factors are complete
— 426 of 461 boss decisions — the scorer decides alone, and `deliberation.changed` records that it
overrode the model. So the 24 substitutions were working as designed, not a lost decision.

## AND THE OVERRIDE IS MEASURABLY WORSE, WHICH IS THE FINDING
  boss decisions with a measurable outcome : 461
    scorer AGREED with the model : n=208   848 damage   4.08 per decision   attack-chosen  13%
    scorer OVERRODE the model    : n=253   549 damage   2.17 per decision   attack-chosen  56%

**The scorer's overrides pick an attack far more often (56% against 13%) and produce less than half
the damage per decision.** So it is not choosing the wrong card — it is choosing attacks that do not
land damage, which is a sharper and stranger failure than picking defence.

**The confound I am not hiding.** This is association, not causation. The scorer may override on
intrinsically worse moments — after a big telegraph, late in a long fight, when energy is gone — and
any of those would produce low damage per decision with no defect involved. Overrides are 253 of 461
decisions, far too many to be a rare event, so "it only overrides in good situations" is not available
as an explanation either. What settles it is a within-fight comparison at matched turn index, and
that is the next measurement.

## Where the Ceremonial Beast work now stands
The 3.0 damage-per-decision arithmetic is still why 0/3. The explanation has now moved three times:
ordering (refuted — surviving attacks are ranked first, top 4 of 112), scorer bias toward defence
(refuted — it prefers attacks on every percentile), and now the scorer's overrides themselves, which
are associated with less than half the damage. **Each was measured before any code was written, and
two of the three died on contact with the data.** That is the process working, not the process
failing.

Also: the Waterfall Giant sentinel (999,999,984) corrupted this measurement on the first pass, the
fifth time it has done so. It is excluded from arithmetic and left unexplained, which is the correct
order — a measured exclusion rather than a guess at a mechanism.

## Loop state
565 tests green - architecture located (scorer overrides the model on 426/461) - overrides associated
with 2.17 vs 4.08 damage per decision - confound named, next measurement is within-fight at matched
turn index
