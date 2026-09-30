---
active: true
iteration: 57
maxIterations: 100
---

keep playing get better every run be bol

## REVIEW FINDING: "the completeFactors fallback reverts to the pre-factoring policy, which
## has no waste veto at all" — PARTLY TRUE, AND THE GATE COMPENSATES FOR THE PART THAT BITES
Tested the full path, not the isolated `combine`, because the gate runs on both branches and an
isolated test would have hidden that.

  COMPLETE factors: chose p1 (Defend)   factorFallback false
  INCOMPLETE      : chose p1 (Defend)   factorFallback true

The waste veto IS bypassed on the fallback — the reviewer is right about the mechanism, and it is
the reason the code says so in a comment. But the example given, a self-harm plan that does not
survive, is still caught, because `refuseLethalChoice` runs on the fallback and the alternative's
forecast states it survives.

**Residual gap, stated precisely:** a plan that WASTES resources but SURVIVES passes unchecked on
the fallback. That is real and it is the Bloodletting/Fortifier family minus the fatal ones. It is
not the safety hole the finding implies.

Not fixed this iteration. The obvious repair — refuse any fallback plan whose waste noul is high —
needs a threshold, and a threshold on a signal that is only sometimes present is a guess. Same
reasoning that stopped the graded-survival treatment: measure the residual first, and a fallback
fires on a minority of boards.

## Loop state
535 tests green · sweep 4: 10/14 · game batch running · server up
