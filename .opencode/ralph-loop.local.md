---
active: true
iteration: 84
maxIterations: 100
---

keep playing get better every run be bol

## THE HYPOTHESIS I NAMED LAST ITERATION IS WRONG, AND WRONG IN THE OPPOSITE DIRECTION
I said the lever was "the deliberation weights safe above prog". Measured, on 2011 ranked boss plans:

  ATTACKING plans : n=1007  mean 0.2117  p25 0.0750  p50 0.2593  p75 0.3810
  DEFENSIVE plans : n=1004  mean 0.0602  p25 -0.1749  p50 0.1419  p75 0.3608

**The scorer prefers attacks on every percentile** — mean 0.21 against 0.06, and the defensive
distribution is the one with a negative lower quartile. So the ranking is not the thing that is
pushing the agent into defence, and a weights change built on that story would have made it worse.

## AND THE GATE IS NOT DOING IT EITHER
On the 112 declined turns the gate says, every time:

  safetyGate        : null
  safetyGateReason  : "the chosen candidate's own forecast states it survives (quality "partial"),
                      so there is no lethal forecast to refuse"

The gate is correctly declining to intervene, exactly as designed. It is not overriding anything.

## WHAT THE 112 ACTUALLY CONSIST OF
  the MODEL's own choice was already an attack        :  24
  model choice != what was executed                   :  59
  model and execution agreed, no override in between  :  53

The clean defect is the 24: the model chose an attack, and a different plan executed. One of them
picked `p4 "Setup Strike -> Lagavulin Matriarch -> End"` and the run played `p3 "Feel No Pain -> End
turn"`. I do not have the mechanism for that substitution and I am not going to invent one — the
gate is inert, the scorer prefers attacks, and something between the model's answer and the executed
command is not yet accounted for.

**The 53 are not obviously wrong either.** "Feel No Pain" is a block-generating power; against a boss
that ramps from 12 to 32, banking block is defensible play that my binary "does the label name an
attack" test scores as a non-attack. The measurement is cruder than the decision it is judging.

## Where this leaves the Ceremonial Beast work
The 3.0 damage-per-decision arithmetic stands — it is arithmetic and it is why 0/3. The explanation
for it does not. Two of three candidate mechanisms (ordering, scorer bias) are now measured and
refuted, and the third (the 24 substitutions) is real but unexplained. **I am not shipping a change
against a refuted story**, which is now the standing rule after five wrong causal stories in this
session.

The next measurement is narrow: find the code path that turns `jevMove.choice` into the executed
candidate, and see what it does when they differ.

## Loop state
565 tests green - scorer prefers attacks (bias hypothesis REFUTED) - gate inert - 24 model-vs-executed
substitutions real but unexplained - no change shipped
