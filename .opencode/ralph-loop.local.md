---
active: true
iteration: 138
maxIterations: 100000
sessionId: ses_f14aeb718ffedJJQ75aBotmgwX
---

Autonomous operation. Play, measure, improve the agent. Keep the loop and the batch running.
**This file is the state, not the archive.** Per-iteration findings go in `git log`; if this grows
past ~90 lines it is being used as a diary again and the rules at the bottom are getting crowded out.

## PLAN
M1 INSTRUMENT  measurement precedes every change              DONE
M2 EVIDENCE    comparable difficulty signal                    BLOCKED — needs an A10 run
M3 DECISION     override question answered                     DONE — no measurable difference
M4 READ         frontier reviews converted                     5 of 10 read
M5 HARDEN       no unmeasured change ships; failures visible   DONE (twice, both verified live)

## THE NUMBERS THAT MATTER
  A0 fight win rate      88%   saturated — cannot show improvement
  A0 median run floor    17    flat since iteration 62
  A0 best run             33    The Insatiable (Act 2 boss), 42% of it taken off
  boss record             10/21 (48%)  flat
  wins                    0     in every recorded run
  A/B                     379 samples, scorer -0.004 damage/decision — CONVERGED TO NULL
  tests                   610 green

**The honest headline: 135+ iterations of correct, measured, verified fixes and the median run did
not move.** Every lever I can reach is already at its correct value.

## RULED OUT — with the number that killed each. Do not re-investigate.
  gate failure       correct on all 31 deaths; no survivor existed to move to
  decision failure   blocks 9-in-10 when affordable, 0-in-10 when not
  energy exhaustion  23.8% won fights vs 25.0% lost — indistinguishable
  deck thinning      24% block share IS the game's distribution; picks neutral at 1.01x
  card-pick bias     none; the game offers 23% block and the agent takes 24%
  dead cards in deck 59 of 61 picks are playable
  elite entry HP     no monotonic relationship; low HP is NOT worse
  early-death shape  same resource position as later deaths (80% / 63% no playable card)
  Stun               0.85x across 29 fights — unmodelled, fix SHIPPED, effect modest
  label ambiguity    69% was old code; 7.8% in the last 30 decisions
  astra timing bug   real in code, unreachable — the card is never offered as a candidate
  unoffered blocks   0% — Smoggy makes them unplayable, so declining is correct

## M3 FINAL: THE A/B CONVERGED, AND IT CONVERGED TO NOTHING
  230 samples (iter 105)  modelDelta  +0.121
  246 samples (iter 116)  modelDelta  -0.121
  379 samples (iter 137)  modelDelta  -0.004     <- 35 depths, both arms

**Randomised, depth-matched, interleaved within the same fights: the scorer's choice and the model's
own choice deal the same damage per decision.** The progression is a clean convergence to null rather
than a noisy wobble, which is what a real null looks like and is not what a real effect looks like at
this sample size.

**So the answer to M3 is stronger than "mildly better": there is no measurable difference**, and the
factor-scoring layer is not earning its complexity on this metric. The observational estimate that
started all of this said -1.501; it was turn depth, and correcting for it moved the sign twice before
reaching zero.

Careful about what this does NOT say: this is damage per decision. The scorer might still help on
survival, on tempo, or on decisions whose damage is zero either way, and nothing here measures those.
What it does say is that the layer cannot be justified on damage, and the next thing worth measuring
is an axis where it might actually differ.

**This is what the randomised arm was built for.** The observational number was confidently wrong by 1.5
damage/decision and would have been acted on.

## OPEN ITEM 4 ANSWERED: THE SCORER CHANGES BEHAVIOUR AND BUYS NOTHING MEASURABLE
  MODEL arm   n=197   survives=true 94.9%   damage/decision 9.61   attacking 53.3%  blocking 19.8%
  SCORER arm  n=228   survives=true 93.9%   damage/decision 7.63   attacking 61.8%  blocking 16.2%

**Three readings, and they point one way.**

1. **Survival: 94.9% vs 93.9%.** No difference. The scorer is not buying safety.
2. **Damage: 7.63 vs 9.61 raw — but the depth-matched A/B says -0.004.** The raw comparison is not
   matched and the matched one is the correct comparison, so the honest statement is that the two arms
   are indistinguishable on damage, and the raw gap is depth, not effect. (Noting the conflict rather
   than quietly dropping the unflattering number.)
3. **Behaviour DOES differ, and this is the finding: the scorer attacks 61.8% against the model's
   53.3%, and blocks 16.2% against 19.8%.** The scoring layer systematically pushes the agent
   toward aggression — and that shift shows up in no outcome measured here.

**So the scoring layer is not inert; it is unmotivated.** It changes what the agent does and the
change is not compensated by anything we can see. That is a stronger and more actionable statement
than "no difference": it means there IS a behavioural lever there, and the layer is currently
spending it for nothing.

## WHAT IS OPEN
  1. **Ascension 10** — no reachable menu screen sets it. The primary metric is unmeasurable, and at
     88% on A0 no improvement is even detectable in principle. THIS IS THE ONLY REAL BLOCKER.
  2. **Unmodelled mechanics** — `spire-demo/docs/unmodelled-mechanics.md`. Stun shipped. Ravenous 335,
     Steam Eruption 207, Ritual 156, Plating 148 are next. Per-power win rate is the prioritisation
     method and most ratios are n<6 noise, so MORE RUNS is the lever, not more analysis.
  4. **The scorer's aggression bias** — ANSWERED above. It attacks 8 points more and blocks 4 less
     than the model's own choice, and that buys no measurable damage or survival. Either the weight
     on `waste` is pushing toward aggression without cause, or aggression is right and the
     `progress` axis is under-weighted. Those are testable, and they are the first thing in a long
     while that is a live hypothesis rather than a dead end.

## RULES — earned, not negotiable
- **A zero from a lookup, and a name from a regex, are both evidence about the lookup.** Ten wrong
  fields this session: descriptor, move probabilities, deck piles, GAME_DATA keys, can_play (×2),
  enemy powers vs cards, review heading formats, label token, durability of can_play.
- **Check a field is a DURABLE property before counting on it.** `can_play` is per-frame AND means
  "unplayable right now"; `type` is durable. Reading a name out of prose is neither.
- The corpus spans ~100 code versions. Every number names its sha and a recency slice.
- A quiet failure is not a result. Find out why before writing a story about it.
- An existing test refusing a plausible change is the system working. Put the reasoning IN the test.
- Never `npm test | grep` — that returns grep's status. A pipeline in a verification step is a
  verification step that cannot fail.
- Measure the effect BEFORE writing the fix. All four refuted mechanisms looked obvious.
- Record what was NOT done and why. That is most of the value.

## LOOP STATE
Play running on the batch's real budget (90M tokens, 20k decisions). `labelAmbiguity` and
`deckComposition` are recorded per decision. Batch failures print in capitals and write
`.private/loop/BATCH-FAILED.txt`; a stall is reported after 3 resumes rather than absorbed forever.