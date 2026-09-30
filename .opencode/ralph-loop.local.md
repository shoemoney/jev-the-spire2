---
active: true
iteration: 41
maxIterations: 100
---

keep playing get better every run be bol

## SWEEP 3 FOUND A REAL DEFECT, AND IT IS THE BEST ONE YET
The review loop re-read the CURRENT code (255KB packet, the first two sweeps predate the card
conditions, the attrition signal, the seen-card floor and the card-select fix). Its first finding:

**Elite-avoidance guidance was gated to `act === 2`.** So the only text in the codebase that says
"prefer a path with fewer elites" fired in the act the agent reaches once, while:

  deaths by act:   19 in Act 1,  1 in Act 2
  elite win rate:  11/34  (32%) — the worst class in the corpus
  95% of the runs that died, died in the act where the guidance was silent

Fixed: the guidance now applies in every act. The text is unchanged because it was never the
problem — it is a route preference, not a claim that elites are always bad, and it already says
not to take a worse route merely to reduce elite count and to keep all routes available. The GATE
was the bug.

`act2-route.test.mjs` asserted acts 1 and 3 must NOT carry it. **The test pinned the defect.** That is
the first time in this loop a test has actively protected a bug, and it is a different failure mode
from the eight measurement errors: those were me misreading, this one was the suite agreeing with
me. Rewritten to the corrected contract, keeping every real guard.

This is what the multi-model loop is FOR. Every measurement I took was consistent with this being
fine, because none of them compared guidance-coverage against where deaths happen.
