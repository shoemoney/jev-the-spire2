---
active: true
iteration: 74
maxIterations: 100
---

keep playing get better every run be bol

## THE VERDICT ON MY OWN WORK, USING THE INSTRUMENT I BUILT
Asked the question the whole code-stamp apparatus exists to answer: did any of this help?

  stamped versions that actually played a fight:
    abbd694  5 fights  won 5  lost 0   A0
    35ddb56  3 fights  won 2  lost 1   A0
    47fe1c4  1 fight   won 1  lost 0   A0
    ff06fa6  4 fights  won 2  lost 1   A0  (+1 unresolved)

**10 fights, all Ascension 0, n too small to conclude anything.** And A0 has been 88% since
iteration 62 — it is saturated, so even 200 more A0 runs would not move the number worth steering by.

## WHY THERE IS NO A10 DATA: TWO BUGS, BOTH OF WHICH HAD TO BE FIXED
The batch has always tried to select Ascension 10 and warned loudly when it failed:
  [WARNING: ascension is 0, not 10 - this run is NOT comparable to earlier ones]

That branch had never once executed. Two independent bugs, either of which alone was fatal:

  1. `options` is an array of OBJECTS - [{"name":"IRONCLAD","enabled":true}, ...] - read straight
     off the bridge. `String(o)` is "[object Object]", so the test never matched.
  2. `includes('ASCEND')` **does not match "ASCENSION"**. A-S-C-E-N-S-I-O-N. The stem is "ASCEN".
     Even handed plain strings it was constant-false.

Both fixed, proven against the real shapes:
  'ASCEND' in 'ASCENSION LEVEL' : false    <- the old stem
  'ASCEN'  in 'ASCENSION LEVEL' : true     <- the fix
  {name:'Ascension Level 10'}   : matches
  character list               : no match  <- and this is the finding

**The character_select options list contains only characters.** IRONCLAD, SILENT, REGENT,
NECROBINDER, DEFECT. There is no ascension or difficulty control exposed there, so even with both
bugs fixed the run starts at Ascension 0 — and the batch now says so out loud instead of leaving it
to be discovered later in a statistic.

So: the primary metric — A10 non-boss win rate, 80% — cannot move from here. Not because the
bridge lacks the endpoint, but because that screen has no control to set it.

## What that means for the loop
Iterations 63-73 produced: a kill instrument that found 5 boss kills the loop had been reporting as
zero, a code-version stamp on every log entry, an attrition signal fixed from a forecast to an
observation, an 8-point difficulty gradient, a relevance filter on nine prose checks, and one
genuinely dead end (the payload). Every one of those is real and none of it moved the win rate,
because the win rate has not been measurable at the difficulty that matters.

**Starting an Ascension 10 run in the game UI is the one thing left that is not mine to do.** From
the moment it does, `byCode` groups every new fight under a known sha and the number finally has
provenance. That is the handback.

## Loop state
562 tests green - payload investigation closed - ascension selection fixed and proven, blocked on a human
