---
active: true
iteration: 63
maxIterations: 100
---

keep playing get better every run be bol

## I WAS MEASURING HISTORICAL CODE, AND IT INVALIDATED MY OWN LAST ITERATION
Chased the multi-hit blindness and it did not exist. In order:

  parseIntentLabel over every label in the corpus : 544/544 NxM accepted, 0 rejected
  rejected intents by type                        : Buff 895, Debuff 361, Defend 175, ... — NO
                                                   Attack intent is ever rejected. Every reject is a
                                                   non-damage intent whose label is empty BECAUSE
                                                   it telegraphs no damage.
  mismatched labels (total != perHit x hits)      : 0
  yet 94 forecasts warned "incoming attacks could not be parsed"

So the parser the warnings describe is not the parser in the tree. Dating them settled it:

  day     combatDecisions  unknownForecast  "could not be parsed" warnings
  09-23        354              38   10.7%                    34
  09-24        415             121   29.2%                    60
  09-30       3291              38    1.2%                     0

**All 94 are from 09-23/09-24. Zero today. Unknown forecasts fell 29.2% -> 1.2%.** The multi-hit
parse fix landed days ago; I spent an iteration diagnosing a bug that had already been fixed,
because the corpus is a mix of code versions and nothing in it said so.

The 20.4%-vs-4.0% multi-hit correlation was inflated by exactly those old runs. There is no
multi-hit parse bug. There is no NxM inconsistency. Gremlin Merc's "22 multi-hit, 0 blind" was
never evidence of a working parser; it was evidence that runs are not one code version.

## What this costs, stated plainly
Every number I have reported over the WHOLE corpus is partly a measurement of the past. That
includes the A10 gradient. Re-measured on current code only:

  A0    90 fights  88%   boss 5/11
  A10   30 fights  80%   boss 0/1

**The 8-point A10 gap survives** — it is real and current. The A3 band is GONE; all 11 A3 fights
were 09-24. So "A3 is 91%, better than A0" was also historical, and I was about to explain it.

## The actual lesson, and the guard it implies
The instrument caught the error, but only because I dated the warnings instead of trusting the
count. A log that accumulates across code versions will happily report a fixed bug as a live one
forever. The fix is a time axis on the corpus, so "how are we doing" can mean "how did the CURRENT
code do" — the only version of that question worth answering.

## Loop state
547 tests green · sweep 4: 11/14
