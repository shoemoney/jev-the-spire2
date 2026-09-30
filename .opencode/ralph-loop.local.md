---
active: true
iteration: 60
maxIterations: 100
---

keep playing get better every run be bol

## THE LOOP HAD NO KILL INSTRUMENT AT ALL — SO IT INVENTED ONE, TWICE, WRONG
Found while chasing "six boss fights, no kill": there is no boss-kill code in this project.
`replay/metrics.mjs` measures how DEEP a run got, never whether a fight was WON. Every kill number
I have ever reported came from a throwaway python script. Two of them disagreed:

  "6 boss fights, no kill"  grouped each run's boss sequence and called it a loss whenever the run
                            ended — which is exactly what happens AFTER a kill, on the walk to the
                            next act. The one real kill read as a loss.
  "12 won, 0 lost"          scanned past the run boundary, so the NEXT run's first non-combat
                            decision read as "the boss died". Every completed fight read as a win.

Built `fightOutcomes()` off the transition the log already records: leaving a combat screen with
the run alive is a win, `run_end` mid-combat is a loss, a log that ends mid-fight is `unresolved`
and is NEVER guessed. Both wrong numbers are now named regression tests.

  ALL FIGHTS 154   won 132  lost 21  unresolved 1   rate 86.3%
  monster 117/8 · elite 10/7 · BOSS 5 won / 6 lost / 1 unresolved

**The agent has killed 5 bosses. I have been reporting 0 for many iterations.**

## THE FIRST DRAFT OF THE FIX REPEATED THE ORIGINAL BUG
I whitelisted post-combat screens, which quietly turned 4 real boss kills into `unresolved`
because `card_select` was missing from the list. Checked the data before widening the list: all 4
had `enemies: 0` and followed a monster/event/shop/rest screen, so they were reward picks. Then
deleted the whitelist instead of extending it — a win is a positive observation, and making a known
outcome depend on having enumerated every way it can be observed is the same mistake in new
clothes. Deleting it moved boss wins 1 -> 5.

The instrument caught its own error four times in the first ten minutes. That is the argument for
building it rather than reasoning about it: every hand-rolled version of this number, mine included,
was wrong, and the module is the first one that can prove why.

## Loop state
542 tests green (7 new) · sweep 4: 11/14 · game batch running
