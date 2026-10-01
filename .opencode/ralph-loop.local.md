---
active: true
iteration: 141
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

## M3 FINAL: THE A/B CONVERGED TO NOTHING
  230 samples (iter 105)  modelDelta  +0.121
  246 samples (iter 116)  modelDelta  -0.121
  379 samples (iter 137)  modelDelta  -0.004     <- 35 depths, both arms

Randomised, depth-matched, interleaved within the same fights: **the scorer's choice and the
model's own choice deal the same damage per decision.** A clean convergence to null, not a noisy
wobble. The observational estimate that started all of this said -1.501; it was turn depth, and
correcting for it moved the sign twice before reaching zero.

This is damage per decision only. Survival and tempo are not measured, and the layer cannot be
justified on damage. **The randomised arm was built because the observational number was confidently
wrong by 1.5 damage/decision and I was one step from acting on it.**

## ITEM 4, RESOLVED WITH A SOUND CLASSIFIER — AND ONE PART IS STILL UNSOUND
Classified by the hand entry at `command.card_index` and that card's own `type` (never a label regex):

  MODEL   n=188   attack 50.0%   skill 36.7%   power 8.5%   end 3.2%
  SCORER  n=227   attack 44.9%   skill 38.8%   power 0.0%   end 12.8%

**SOUND, from that path:** the scorer attacks slightly LESS (0.90x, the opposite of the broken
reading), plays skills slightly more (1.06x), and **played no Power card at all in 227 decisions
against the model's 16 in 188.**

**REFUTED, my own mechanism guess:** I assumed the `waste` noul punishes powers, since a Power does
nothing for the current turn. Measured across all candidates in both arms:

    power  n= 2127   mean waste noul 0.627
    skill  n=11832   mean waste noul 0.606
    attack n=21612   mean waste noul 0.615

Flat. Power cards are not scored as wasteful, so that story is dead.

**UNSOUND, and therefore not being claimed:** "a Power ranked first in 115 decisions" came from
parsing `ranking[0].id` as a hand index, and ids are not reliably `p<n>` in this log. That number is
withdrawn rather than reported with a caveat.

**The second reading, which is the CONTROL: was a Power even available?**

    model   n=199   a power in hand & affordable   65 (32.7%)   played one  17 (8.5%)
    scorer  n=230   a power in hand & affordable   40 (17.4%)   played one   0 (0.0%)
    played a power when one was available:   model 17/65 = 26.2%   scorer 0/40 = 0.0%

**The finding survives its own control.** It is not that powers were unavailable to the scorer arm —
they were affordable on 40 of 230 decisions and the scorer played one, ever. The model plays one 26%
of the time when it can.

**And the likely mechanism is the scorer's local rationality, not a bug.** `progress` asks whether the
candidate "makes real progress toward winning, such as securing a kill, applying a debuff that pays
off, or spending energy efficiently" — a Power does none of those on the turn it is played, so
`progress` rates it near zero and it loses to a skill that blocks. The scorer is pricing THIS turn; the
model's own choice is apparently less myopic about a card whose value is next turn.

**So item 4 closes as: a real behavioural gap, correctly caused, with no measured cost.** The A/B
found no damage or survival difference, and at 88% A0 fight win rate there is very little room for
a power-play difference to show. Whether playing more powers is actually better is a question this
corpus cannot answer — and that is the same wall as M2, from a different direction.

## WHAT IS OPEN
  1. **Ascension 10** — no reachable menu screen sets it. The primary metric is unmeasurable, and at
     88% on A0 no improvement is even detectable in principle. THIS IS THE ONLY REAL BLOCKER.
  2. **Unmodelled mechanics** — `spire-demo/docs/unmodelled-mechanics.md`. Stun shipped. Ravenous 335,
     Steam Eruption 207, Ritual 156, Plating 148 are next. Per-power win rate is the prioritisation
     method and most ratios are n<6 noise, so MORE RUNS is the lever, not more analysis.
  3. **The scorer never plays a Power** — 0 of 40 opportunities vs the model's 17 of 65. Control
     passed; the waste mechanism is refuted; the likely cause is `progress` pricing only this turn,
     which makes it defensible rather than broken. No measured cost at 88% A0. Same wall as M2: the
     corpus is too easy to show whether playing powers helps.

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