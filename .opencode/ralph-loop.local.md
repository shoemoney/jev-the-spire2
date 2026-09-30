---
active: true
iteration: 18
maxIterations: 100
---

keep playing get better every run be bol

## Built the thing that would have prevented three of my own bugs
`.private/loop/fight-outcomes.mjs`. This session produced THREE wrong headline numbers, all
measurement mistakes, not code mistakes:

  1. "the agent never skips"  — parsed a field that is not the field. It skips 37%.
  2. "potion spent on a floor-3 mob" — read the wrong run's log file. It was floor 14, full HP.
  3. "90 fights, 50 lost — half die" — matched deaths by FLOOR. Floors repeat: one death at
     floor 6 had ELEVEN distinct fights sharing it.

The floor bug was the dangerous one: wrong in the direction that LOOKS alarming, and it also
hid a real pattern. Outcomes derived by ORDERING instead show blocking streaks at 95% -> 87% ->
81% won, which is what was spotted by eye before it was measurable.

THE RULE now encoded in the tool: a fight is lost iff the run ENDS during it. An ordering
fact about the log and nothing else. Never infer it from a floor, an encounter name, or a
heuristic. It reproduces the corrected figures independently: 106 fights, 94 won, 12 lost, 89%.

## Current measurements
  fights 106 · won 94 · lost 12 (89%)
  floors at death: 14, 9, 14, 11, 12, 6, 8, 7, 15, 17, 6, 8 — best 17
  batch run 2 reached floor 15, the deepest since the boss run, then stalled on a card_select
  screen and had to be resumed.

## Still not claimed
- n=26 on the 3+ blocking bucket. 95% -> 81% is suggestive, not significant.
- No post-reorder BOSS sample. The one boss in the corpus predates the reorder.
