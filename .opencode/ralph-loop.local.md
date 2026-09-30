---
active: true
iteration: 91
maxIterations: 100
---

keep playing get better every run be bol

## THE EXPERIMENT IS LIVE AND IT ACTUALLY CHANGES BEHAVIOUR
Armed in two places, because an experiment that only runs until the next crash produces a sample
too small to read and no way to know it stopped:
  - the batch's self-restart path now sets `SPIRE_AB_MODEL`, so it survives every restart
  - the running server, restarted on the batch's real budget with the flag on, sha ed4e395

First armed decisions, and the check that matters — does the arm change what is PLAYED, or only
what is logged:

  MODEL  (plays the model's own choice)   jevMove=a1  executed=a1   <- the arm took effect

That is the difference between an experiment and a label. An arm that recorded `abArm: 'model'` and
then executed the scorer's choice anyway would have produced a clean, confident, meaningless result,
and the read-out would have shown it.

  decisions carrying an arm : 7   (model 4 / scorer 3)
  depths with both arms    : 0
  modelDelta               : null — not enough yet

Seven decisions and a 4/3 split is the hash doing roughly what a hash should. **No reading yet, and
the read-out says so rather than producing a number from seven samples.**

## Where the experiment stands
`abImpact` compares the arm PLAYED, depth-matched. `overrideImpact` compares `changed`, which is the
confounded question and is kept because the association is real and worth re-checking. Two different
questions, two different functions, and the summary says which is which.

The thing to watch is not the first result — it is the sample size. At 3,319 decisions the
observational estimate was well-powered; the randomised one needs comparable depth coverage, and until
`depthsWithBothArms` is in the dozens the honest read is "not yet".

## Loop state
580 tests green - A/B live, interleaved, both arms firing, arm effect VERIFIED on real play
- 7 armed decisions, 4 model / 3 scorer - no result claimed
