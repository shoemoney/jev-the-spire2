---
active: true
iteration: 65
maxIterations: 100
---

keep playing get better every run be bol

## ATTRITION WAS ARITHMETIC ON A PREDICTION
`dealt` was `actions.map(a=>a.forecast).find(f=>f.damage>0)` — the first CANDIDATE that predicted
damage. Not the chosen plan. Not a number that landed. And it sat directly beside `taken`, which is
an observation and was documented "Observed, never assumed", so a rate built from a prediction over
an observation was being quoted as a verdict.

Now observed, and the honest gap handling matters as much as the measurement: a turn that cannot be
measured is NOT a turn where nothing was dealt. `Number(null)||0` was silently understating the
kill rate, and a partly-measured fight now reports `unknowable` rather than dividing by all turns.

## LIVE DATA CAUGHT MY OWN FIX TWICE, WHICH IS WHY IT IS NOW PERSISTED
`attrition` was passed to the model but never written to the log, so the fix was unfalsifiable.
Logging it immediately exposed two bugs in the fix itself:
  1. a single pending reading, overwritten by every decision inside the turn, so a fight went
     34 -> 28 and recorded `dealt: 0`
  2. even two readings per turn measured nothing, because the agent's actions resolve BETWEEN
     observations — there is no reading of the enemy at the instant a turn ends. The comparable
     pair is consecutive TURN STARTS: the drop from one turn's opening reading to the next is
     exactly what that turn's actions did.

Live, after the fix:
  turns 3  dealt 18  taken 9  perTurnDealt 6  status out-lasting-the-enemy

## A RESTART COULD NOT BEGIN A NEW SESSION
Hit "Session budget reached. Restart the server to begin another session." — and restarting did
not work, because the snapshot restore copied `decisions`/`inputTokens` across while re-raising the
limits. An instruction that cannot be followed, and it stops the loop SILENTLY: the agent just
stops deciding and the log stops growing, which looks exactly like a game that went quiet.
Restarts now zero the meter and keep the fight context. Verified: `decisions: 1 / 2000`, running.

## KNOWN FLAW, NOT FIXED — recorded rather than discovered later
`dealt: 18` against `startEnemyHp 85 - lastEnemyHp 73 = 12`. The 6-point gap is an ENEMY LEAVING
THE SET: `nowEnemyHp` sums LIVE enemies, so a kill drops the sum without the agent having dealt
that damage, and `dealt` conflates the two. Needs per-entity tracking keyed on `entity_id`, not a
sum over whoever is currently standing. Until then `perTurnDealt` runs slightly HIGH, which makes
the agent think fights are ending faster than they do — the optimistic direction, but wrong.

## Loop state
553 tests green · stamping live · attrition now observed and auditable
