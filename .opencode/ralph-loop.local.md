---
active: true
iteration: 38
maxIterations: 100
---

keep playing get better every run be bol

## I HAVE TO RETRACT THE HEADLINE
The "first boss kill" and "Act 2 floor 31" are real events. They are ALSO not comparable to
anything measured before, because of a difficulty drop I let slip through.

  session                     ascension   max_hp                    deepest
  2026-09-23T20-41            [3, 10]      [75,80,85,86,91]         floor 14
  2026-09-30T01-45            [10]         [80, 86]                 floor 15
  2026-09-30T02-03            [10]         [80]                     floor 17
  2026-09-30T02-36            [0, 10]      [80,87,91,98]            floor 17
  2026-09-30T04-40            **[0]**      [80,85,91,97]        **floor 31**

**The whole session containing the boss kill ran at ASCENSION 0.** Every earlier run was 10. The
improvement is confounded with an easier game and I reported it as progress.

Cause: the batch navigates `main_menu -> singleplayer -> standard -> IRONCLAD -> confirm`, and
nothing in that path sets the ascension, so the game defaults to 0. The earlier "ascension 10"
runs were a resumed SAVE, not a fresh one — fresh runs have all been ascension 0 since.

The batch now navigates to the ascension control, asserts the run starts at 10, and PRINTS A WARNING
if it does not. A metric that silently changes difficulty is the same failure class as a metric that
silently changes definition.

## What survives the retraction
- The agent is still alive two acts deep — that is a real behavioural change, at a lower difficulty.
- 515 tests green, all the landed fixes are real and independently verified.
- What is NOT established: that the agent got better at Ascension 10. That has to be re-measured.

## Next
Re-baseline at ascension 10 before any further comparison.
