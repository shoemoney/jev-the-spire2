---
active: true
iteration: 98
maxIterations: 100
sessionId: ses_f14aeb718ffedJJQ75aBotmgwX
---

keep playing get better every run be bol

## THE UPSTREAM FIX, DONE AND MEASURED — AND IT DID NOT NEED THE GAME
The planner is a pure function of state, so the new quality distribution can be measured by
replaying RECORDED states through the new code. That answers "is `calculated` reachable now?" while
play is blocked on a click.

    replayed 2075 distinct recorded combat states through the NEW planner
      partial      1297   62.5%
      calculated    776   37.4%     <- was 2.0% before this change
      unknown         2    0.1%

**`calculated` went from 2.0% to 37.4% — eighteen-fold — and the quality field now carries
information.** The recorded `partial` warnings were 7,916 unmodeled relic/power against 462 of any
other kind, so 94.5% of them were the noise that was making the field constant.

The warnings are still reported to the model on those 776 forecasts (915 unmodeled relic, 69 enemy
power, 5 player power) — the model should know what it is not simulating. They just no longer
degrade the forecast's *completeness*, which is the distinction that was missing.

## Two existing tests refused the first version, and both were right
**1. Absence of a description is not evidence of absence.** The first version ran the relevance regex
over `name + description`, so `{id:'UNKNOWN', name:'Mystery'}` — an effect the game ships with no
text for — failed to match and was classed harmless. In the one place where being wrong makes the
agent more confident about a turn it has not simulated. An existing test caught it.

**2. Completeness and provenance are different reasons.** `planner-kb.test.mjs` requires that a card
resolved from a recorded corpus reading is never advertised as `calculated`, and it is right for its
own reason: a corpus reading is not a simulation however well it matches. So `partial` now means
*either* something survival-relevant on the board is unmodeled, *or* a number came from a recorded
reading. Filtering only the unmodeled-relic warnings keeps both intentions instead of picking one.

**Twice now this session a test written earlier has refused a plausible change I was about to make.**
581 green.

## Why I am NOT tightening `statedSurvival` in the same iteration
It is now *possible* — requiring `calculated` would apply to 37% of decisions rather than 2% — and it
is still the wrong move today. Changing the vocabulary and the consumer of that vocabulary in one
step means any effect afterwards is unattributable. The order is: make the field meaningful, play on
it, confirm the distribution holds on live data, and only then make the gate strict. That is the
order the review's own suggestion implied and the order I nearly got wrong.

## Loop state
581 tests green - quality vocabulary fixed upstream: calculated 2.0% -> 37.4% on 2075 replayed states
- gate NOT tightened, deliberately, pending live confirmation of the new distribution
- GAME STILL PARKED, click still required