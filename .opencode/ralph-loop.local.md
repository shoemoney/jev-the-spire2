---
active: true
iteration: 47
maxIterations: 100
---

keep playing get better every run be bol

## SWEEP 4 (74-file packet) CAUGHT THE GAP IN MY OWN LAST FIX
I published `displayed_incoming_attack_lower_bound` last iteration. It went into the request text and
nowhere else. `forecast.survives` still returned null, so `refuseLethalChoice` saw null and stayed
silent. **The number decorated the request and did no work** — the same "honest note around a
quantity that does nothing" mistake, one iteration on.

    12 HP, 12 readable incoming, 1 UNREAD intent
      incoming (total)   : null      <- genuinely unknown
      incomingLowerBound : 12
      boundedLethal      : true
      SURVIVES           : false     <- was null; the gate could not see this
      statedSurvival()   : false

The arithmetic is not in doubt: if the readable intents already exceed HP plus block, the turn is
lethal whatever the unread ones are, because they can only add. That is where the missing early
verdict in 18 lost fights comes from.

## SCOPED TO `!parsed`, AND THAT IS A KNOWN LIMITATION
A floor exceeding HP plus block proves death under ANY uncertainty — a facing multiplier only
raises the damage. So the narrow gate leaves a real improvement on the table. But four existing
tests pin `survives: null` when the cause is POSITIONING, and overturning four deliberate safety
rules on the strength of my own reasoning is exactly the over-reach that has broken this codebase
repeatedly. So it fires for the case it was built for, and positioning is untouched. Widening it is
a separate, argued change.

## The admission cannot be made symmetric by accident
A floor is admitted for `false` only. A plan is never called a survivor on a lower bound, because
a lower bound cannot prove safety. `statedSurvival({unknown, survives:true, boundedLethal:true})`
returns `null`, not `true` — pinned by a test.

## Loop state
522 tests green · sweep 4 running with full coverage · server restarted · both batches going
