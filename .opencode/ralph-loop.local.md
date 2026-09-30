---
active: true
iteration: 27
maxIterations: 100
---

keep playing get better every run be bol

## THE UNEXPLAINED AUTO-PAUSE IS SOLVED
Traced it by hashing consecutive states in every session file rather than guessing:

  2026-09-23T20-41  1158 decisions |   0 actions that changed nothing
  2026-09-30T01-45   128 decisions |   0
  2026-09-30T02-03   145 decisions |   0
  2026-09-30T02-36  1088 decisions |   8   <- all `card_select`

Every action the game ignored was on a card-select screen, and every one of them was
`confirm_selection` or `select_card`. Nothing else in the corpus has ever issued a no-op. So the
mystery was not a second bug — it was the screen I fixed last iteration, seen from its other side.

That is the whole shape of this loop's recent failures: one screen, seen through four different
symptoms (stall, 22 decisions, auto-pause, silent server death from the batch giving up).

## Fresh session file, deliberately
The stuck session also carried the pre-card-select-fix decisions, so post-fix data could not be told
from the run that produced the symptom. `session.json` is moved aside and a new session started, so
every future measurement is on a build where that class of bug cannot occur.
