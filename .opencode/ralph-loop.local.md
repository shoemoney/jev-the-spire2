---
active: true
iteration: 144
maxIterations: 100000
sessionId: ses_f14aeb718ffedJJQ75aBotmgwX
---

Autonomous operation. Play, measure, improve the agent. Keep the loop and the batch running.
**This file is the state, not the archive.** Findings go in `git log`. Past ~90 lines it is a diary
again and the rules below are crowded out. Condensing is an iteration's work, not an afterthought.

## PLAN
M1 INSTRUMENT  measurement precedes every change              DONE
M2 EVIDENCE    comparable difficulty signal                    BLOCKED — needs an A10 run
                 Loop's remaining mode is ACCUMULATING the runs item 2 needs, not searching.
M3 DECISION     override question answered                     DONE — converged to null
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

**The honest headline: 140+ iterations of correct, measured, verified fixes and the median run did
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
  waste punishes powers   0.627 power vs 0.606 skill vs 0.615 attack — flat, story dead
  scorer's aggression    attacks LESS (0.90x), not more; the 61.8% reading was a broken classifier
  scorer plays no Power  0 of 40 opportunities vs the model's 17 of 65 — real, and defensible:
                           `progress` prices THIS turn, and a Power pays off next turn. No measured
                           cost at 88% A0, which is the same wall as M2 from a different angle.

## THE SHAPE OF THE LAST TWELVE ITERATIONS
M3's randomised A/B converged to null (230 -> 246 -> 379 samples, +0.121 -> -0.121 -> -0.004) after
the observational estimate said -1.501, which was turn depth. Item 4 found a real behavioural gap whose
cause turned out to be correct behaviour with no measurable cost. Three of four review headlines
dissolved under measurement. The consistent result is that **almost everything looks like a defect
until it is measured, and the thing that is left is the difficulty being too low to detect any of it.**

## WHAT IS OPEN
  1. **Ascension 10 — the blocker, now fully exhausted (iter 143).** Three routes, all closed:
       - the bridge accepts EXACTLY TWO actions: `menu_select` and `end_turn`. Ten plausible
         configuration actions (`set_ascension`, `set_difficulty`, `ascension`, `start_run`, …) are
         all rejected as unknown.
       - `character_select` exposes 9 options — IRONCLAD, SILENT, REGENT, NECROBINDER, DEFECT,
         RANDOM_CHARACTER, confirm, embark, back — and none sets difficulty. `custom` on the
         singleplayer screen never resolved to a menu with options; the walk falls back to `main`.
       - but the game's own run save carries `"ascension": 0` as a plain integer, so the capability
         exists in the data model and is simply not surfaced. **I am not writing to a save file**:
         it is the user's game data, it may be open in a running instance, and an irreversible edit to
         it is a handback, not an optimisation.

     At 88% A0 fight win rate no improvement is even detectable in principle, which is why items 2
     and 3 both ran out of measurement room. This is the only real blocker and it is not mine.
  2. **Unmodelled mechanics** — `spire-demo/docs/unmodelled-mechanics.md`. Stun shipped. Ravenous 335,
     Steam Eruption 207, Ritual 156, Plating 148 are next. Per-power win rate is the prioritisation
     method and most ratios are n<6 noise, so MORE RUNS is the lever, not more analysis.

## RULES — earned, not negotiable
- **A zero from a lookup, and a name from a regex, are both evidence about the lookup.** Eleven wrong
  fields this session: descriptor, move probabilities, deck piles, GAME_DATA keys, can_play (×2),
  enemy powers vs cards, review heading formats, label token, durability of can_play, `Bash` in two
  lists at once.
- **Check a field is a DURABLE property before counting on it.** `can_play` is per-frame AND means
  "unplayable right now"; `type` is durable. A label is prose; a hand entry at `command.card_index`
  is data.
- **Measure the same quantity twice when it matters.** Two measurements that agree prove nothing; two
  that disagree are what found the `Bash` error and the reversed aggression sign.
- The corpus spans ~100 code versions. Every number names its sha and a recency slice.
- A quiet failure is not a result. Find out why before writing a story about it.
- An existing test refusing a plausible change is the system working. Put the reasoning IN the test.
- Never `npm test | grep` — that returns grep's status. A pipeline in a verification step is a
  verification step that cannot fail.
- Measure the effect BEFORE writing the fix. All four refuted mechanisms looked obvious.
- Record what was NOT done and why. That is most of the value.

## LOOP STATE
Play running on the batch's real budget (90M tokens, 20k decisions). `labelAmbiguity` and
`deckComposition` recorded per decision. Batch failures print in capitals and write
`.private/loop/BATCH-FAILED.txt`; a stall is reported after 3 resumes rather than absorbed forever.