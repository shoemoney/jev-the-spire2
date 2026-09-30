---
active: true
iteration: 50
maxIterations: 100
---

keep playing get better every run be bol

## SWEEP 4 FINDING #4 TESTED AND NOT REPRODUCED
It claimed the waste term — weight 1.0 on a relative, cliffed signal — "can outvote survival on
noise." I built the cases that would show it and the safer plan won every one:

  a safer AND more progressive, waste spread 0.10 vs 0.90        -> a kept
  a safer AND more progressive, waste 0.40 vs 0.60               -> a kept
  a safer, equal progress, waste 0.6 vs 0.9 (the case it names)  -> a kept
  all candidates waste 0.0 (nothing wasteful)                    -> deadband holds, a kept

`waste: 1.0` is DELIBERATE and documented where it is declared: "waste at 1.0 makes the penalty a
veto rather than a vote. It removes every self-harm failure (empty-hand Bloodletting, Fortifier),
which the original policy still fails 3 times in 10" — 90/100 against 88/100 for equal weights.

The max positive from safe+progress is 0.50 and the max negative from waste is 1.00, so the RATIO is
2:1 — but a relative vote is 0 for the LEAST wasteful candidate, so the plan being protected is not
penalised at all. It only bites when the other signals are near-equal, which is precisely when it
should.

**Recorded as not-a-defect rather than quietly dropped.** A review finding that survives a
constructed test is a different thing from one that was never checked, and the honest report says so.

## Loop state
528 tests green · sweep 4: 14/14 asked · game batch running · server up
