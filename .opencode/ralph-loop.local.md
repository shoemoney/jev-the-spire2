---
active: true
iteration: 100
maxIterations: 100
---

keep playing get better every run be bol

## FOURTH REVIEW: A REAL CODE OBSERVATION THAT WOULD CHANGE ONE DECISION IN 5,001
claude-opus-5-5, finding 1. The claim is sharp and correct as an observation: `factsFor` computes
`displayed_incoming_attack_lower_bound`, nothing downstream reads it, and on a blind turn
`survives` is null so the gate cannot fire. `boundedLethal` exists for exactly this shape.

Measured before acting, as the last three taught me to:

    executed decisions with quality unknown                          210
      carrying a numeric incomingLowerBound                           18
      where that floor ALONE >= hp + block, so death is arithmetic      1

    executed decisions with a proven lethal floor (boundedLethal:true)  0

**The proposed fix would fire on exactly one decision in the whole corpus**, and the mechanism it
asks to extend has never executed once. Not shipping it. The observation is true and the effect is
nil, and those are different facts that only a number separates.

## What four reviews actually produced
| review | finding | measured effect | outcome |
|---|---|---|---|
| qwen omni | `partial` licenses survival from an incomplete model | 3246 of 3332 decisions | upstream fix shipped, `calculated` 2% → 38% |
| gemini 3.7 | campfire before elite, across branches | route guidance on divergent maps | fixed; same-row case was already covered |
| glm 5.3 | Thorns null damage blinds the board | 105 occurrences, 43 states | fixed |
| opus 5.5 | lethal floor is computed and not consumed | 1 decision in 5001 | **not shipped** |

Three fixes, one decline, and the decline was the only one that cost nothing to reach because the
number came first. **That ratio is the argument for the process, not for the reviews.**

## The hundredth iteration, honestly
The task is **not** finished and I am not claiming otherwise:
  - the game is parked on a main menu exposing zero options, so no run has been played since
    iteration 93. One human click unblocks it.
  - the A/B needs 200 armed samples and has 25. Its question is open.
  - `statedSurvival` is deliberately still permissive, pending live confirmation that the new
    quality distribution holds.
  - the A10 win rate, the primary metric, has not been measurable since the code stamp went in,
    because the bridge exposes no ascension control on any reachable screen.

What the hundred iterations produced is an instrument that now catches its own author: a kill
counter that found 5 boss kills reported as zero, a code stamp on every log line, an attrition signal
moved from a prediction to an observation, a difficulty gradient, a randomised experiment with a
verifiable arm, a replay harness that measures a code change without playing a single new card, and
four independent reviews converted into three fixes and one measured refusal.

**The most useful thing built this session was not a feature. It was the set of measurements that
stopped six plausible changes from shipping.**
