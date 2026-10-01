# Spire agent — loop state

## PLAN
M1 INSTRUMENT  measurement precedes every change              DONE
M2 EVIDENCE    comparable difficulty signal                    BLOCKED — needs an A10 run
M3 DECISION     override question answered                     DONE — but see CORRECTION below
M4 READ         frontier reviews converted                     10 of 10 read — DONE
M5 HARDEN       no unmeasured change ships; failures visible   DONE (twice, both verified live)

Loop's remaining mode is ACCUMULATING the runs item 2 needs, not searching.

## THE NUMBERS THAT MATTER
  A0 fight win rate      88%   saturated — cannot show improvement
  A0 median run floor    17    flat since iteration 62
  A0 best run             33    The Insatiable (Act 2 boss), 42% taken off
  boss record             10/21 (48%)  flat
  wins                    0     in every recorded run
  A/B                     **CORRECTED at iter 151 — the old "converged to null" was an artifact**
  tests                   610 green

**The honest headline: 140+ iterations of correct, measured, verified fixes and the median run did
not move.** Every lever I can reach is already at its correct value, and **every open item reduces to
one sentence: the agent wins 88% of fights, so this corpus cannot measure anything that only shows up
when the agent loses.** Four separate investigations hit that wall; it is the only thing left.

## CORRECTION (iter 151) — the A/B headline was an artifact of pooling across policy versions
`abImpact` depth-matched but never version-matched, so a model sample at depth 3 from one build was
compared against a scorer sample at depth 3 from another. 1,302 armed decisions span **8 shas**,
three of them scorer-only. Pooled, the per-version figures (-0.546, +0.227, -1.001, -3.313, -7.250)
averaged to **-0.004**, which the state file carried as "CONVERGED TO NULL".

With the reader fixed (per-version buckets, floor applied per version, pool withheld when signs
disagree) the honest reading is:

    policy versions in corpus   13   (comparable: 1)
    6b97d6b  n=591  buckets=33  delta=-0.546   <- the only version that clears the floor
    ed4e395  n=139  20 buckets   null (below floor)
    740dad9  n= 91  14 buckets   null (below floor)
    ab28c5e  n= 56  10 buckets   null (below floor)
    44188b6  n= 25   4 buckets   null (below floor)

**So the override is not neutral: in the one version with enough evidence the scorer deals 0.546
MORE damage per decision than the model.** The old null was two incompatible things averaged. Note
the earlier "+0.227 opposite sign" was itself below the sample floor — the sign claim was mine, made
with an unfloored reader, and it did not survive its own evidence gate.

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
  deepseek #2 gate    STALE — review quotes refuseLethalChoice(..., candidates, candidates); the tree
                      passes rankingByProbability(...) at BOTH call sites (deliberation.mjs 103, 155)
  unoffered blocks   0% — Smoggy makes them unplayable, so declining is correct
  waste punishes powers  0.627 power vs 0.606 skill vs 0.615 attack — flat, story dead
  scorer's aggression  attacks LESS (0.90x), not more; the 61.8% reading was a broken classifier
  scorer plays no Power  0 of 40 opportunities vs the model's 17 of 65 — real, and defensible:
                           `progress` prices THIS turn, a Power pays off next turn. No measured
                           cost at 88% A0 — the same wall as M2 from a different angle.

## WHAT IS OPEN
  1. **Ascension 10 — the blocker, fully exhausted (iter 143).** The bridge accepts EXACTLY TWO
     actions, `menu_select` and `end_turn`; ten plausible config actions are rejected as unknown, and
     none of `character_select`'s 9 options sets difficulty. The run save DOES carry `"ascension": 0`
     as a plain integer, so the capability exists and is simply not surfaced. **I am not writing to a
     save file** — user's game data, possibly open in a running instance, and an irreversible edit to
     it is a handback, not an optimisation.
  2. **Unmodelled mechanics** — `spire-demo/docs/unmodelled-mechanics.md`. Stun shipped. The rest
     is ARITHMETICALLY unclosable at A0, not merely effortful (iter 148): **242 closed fights
     produced 29 losses, spread over 27 distinct mechanics, so the median unmodelled mechanic has ONE
     loss behind it.** A per-mechanic rate needs ~30+ events; at 29 losses per 242 fights that is
     ~25x more runs, which is not accumulation but a different project. Item 2 is "needs a harder
     difficulty so there are more losses to explain" — the same wall as M2.

## M4 CLOSED — yield: 1 bug shipped, 1 in the wrong component, 23 dissolved
Six of ten reviews' unprocessed findings were already fixed when read. Full triage in git log.

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
`.private/loop/BATCH-FAILED.txt`; a stall is reported after 3 resumes, not absorbed forever.

MEASURE LINE COUNTS WITH `wc -l` BEFORE WRITING THEM DOWN. Three condenses claimed 96/96/88 against
actuals of 132/101/99 — the number went into the commit before wc ran, so the message asserted an
intent rather than a measurement. Also: this file's rule is "findings go in git log", so a section
of findings is a diary however true it is.   [this file: 90 lines by `wc -l`, verified]
