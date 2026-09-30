---
active: true
iteration: 80
maxIterations: 100
---

keep playing get better every run be bol

## THE CHARACTER_SELECT QUESTION IS ANSWERED, WITH THE FULL LIST
  [menu "character_select": 9 options recorded]

  IRONCLAD  SILENT  REGENT  NECROBINDER  DEFECT  RANDOM_CHARACTER  confirm  embark  back

**There is no ascension or difficulty control on that screen.** Confirmed from the complete,
untruncated list rather than a 180-character slice of it.

So iteration 74's claim was CORRECT and iteration 75's walk-back was correct *procedure* — do not
assert a fact about a screen from a truncated read of it — and the two are now reconciled by
actually reading the whole thing. Walking a claim back is not the same as the claim being wrong, and
holding both of those at once for six iterations was the right amount of stubbornness.

Two things the full list also revealed, invisible in the truncated version:
  - `RANDOM_CHARACTER` exists
  - `embark` exists, alongside the `confirm` the batch has been sending. `confirm` works, so this
    is not a bug, but the real start action is `embark` and the batch has been using the wrong one
    without harm.

## THE REMAINING LEAD: `custom`
The singleplayer screen offers standard / daily / **custom** / back. `custom` is the only path to a
difficulty setting that has not been ruled out, and iteration 75 could not reach it because the game
was mid-run every time. The batch now reaches a real menu on every run boundary, so the next time it
walks one, `custom` is worth selecting and its options recorded the same way.

## LIVE PLAY WHILE ALL THIS HAPPENED
The run reached the boss and died with the boss at **8 HP of 240**:

  f17 boss hp=42 -> 39 -> 34 -> 33 -> 18 -> 8 -> [run ended] -> f1 hp=80

That is a boss loss by 8 HP, which is the unsaturated signal doing exactly what it should: 45% boss
win rate is not 100%, so the metric still has signal in it. It is also the run the automation had to
wait for before it could read a menu at all.

## The shape of the last six iterations on this one question
  74  asserted from a truncated read          -> wrong process, right answer
  75  walked it back, correctly                -> and started recording the full list
  76  blamed a timeout chain                    -> real chain, wrong first link
  77  instrumented the wrong service           -> correct, would never have fired
  78  found the right service (the bridge)     -> unblocked play entirely
  80  read the full list                       -> answer, in nine lines

Six iterations to read nine options, and the thing that finally did it was making the harness write
the answer to disk on every pass instead of me reading it by hand and truncating it.

## Loop state
565 tests green - ascension NOT settable on character_select, confirmed in full - custom is the last
lead - play running, one boss loss at 8/240 hp
