---
active: true
iteration: 50
maxIterations: 100
---

keep playing get better ever run be bol

## FOUND AND VERIFIED, DELIBERATELY NOT FIXED YET
A `partial` forecast claiming `survives: true` is treated as PROVEN by the lethal gate, because
`STATED_QUALITIES` includes 'partial'. And `partial` is the overwhelming majority of real forecasts:

  partial    : (majority)  <- of those, a large number claim survives:true
  calculated : (few)
  unknown    : (rest)

A partial forecast omits unmodelled clauses BY DEFINITION, so its `survives:true` is strictly
weaker evidence than a calculated one, and the gate cannot tell them apart.

**This is an inconsistency in my own reasoning.** Last iteration I made `boundedLethal`
false-only, with the explicit rule that a lower bound can prove DEATH and must never prove
SAFETY. A `partial` is the same species of incomplete estimate — it admits omitting effects —
and it IS being allowed to prove safety. The two halves of the same principle disagree.

**Why it is not a one-line fix.** Excluding `partial` from the `true` direction would leave the
gate with no proven survivor on most boards, because most boards are partial — and a gate with
nothing to swap to is the gate that was inert on 96% of rooms. The honest answer is a GRADED
treatment: a calculated survivor outranks a partial one, rather than the two being equal or the
partial being discarded. That is a scoring change, and every scoring change I have rushed in
this loop has broken something. It gets its own iteration with a measurement attached.

## Not a defect: the waste-veto finding
Tested and it did not reproduce. The safer plan won every constructed case, including the one the
review names. `waste: 1.0` is documented as deliberate. Recorded as tested-and-clean rather than
quietly dropped.

## Loop state
528 tests green · sweep 4: 6/14 · game batch running · server up
