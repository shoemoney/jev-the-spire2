---
active: true
iteration: 134
maxIterations: 100000
sessionId: ses_f14aeb718ffedJJQ75aBotmgwX
---

Autonomous operation. Play, measure, improve the agent. Keep the loop and the batch running.

## PLAN
M1 INSTRUMENT  measurement precedes every change              DONE
M2 EVIDENCE    comparable difficulty signal                    BLOCKED — needs an A10 run
M3 DECISION     override question answered                     DONE — scorer mildly better, do not disable
M4 READ         frontier reviews converted                     5 of 10 read
M5 HARDEN       no unmeasured change ships; failures visible   DONE (twice — see the log)

## THE NUMBERS THAT MATTER
  A0 fight win rate      88%   saturated — cannot show improvement
  A0 median run floor    17    flat since iteration 62
  A0 best run             33    The Insatiable (Act 2 boss), 42% of it taken off
  boss record             10/21 (48%)  flat
  wins                    0     in every recorded run
  A/B                     230 samples, scorer +0.12 damage/decision (was +0.29 at 230 — shrinking)
  tests                   610 green

**The honest headline: 130+ iterations of correct, measured, verified fixes and the median run did
not move.** Every lever I can reach is already at its correct value.

## WHAT WAS RULED OUT, WITH NUMBERS — do not re-investigate these
  gate failure       correct on all 31 deaths; no survivor existed to move to
  decision failure   blocks 9-in-10 when affordable, 0-in-10 when not
  energy exhaustion  23.8% won fights vs 25.0% lost — indistinguishable
  deck thinning      24% block share IS the game's distribution; picks neutral at 1.01x
  card-pick bias     none; the game offers 23% block and the agent takes 24%
  elite entry HP     no monotonic relationship; low HP is NOT worse
  Stun               0.85x across 29 fights (the 0.28x was boss-only, 6 fights)
  label ambiguity    69% was old code; 7.8% in the last 30 decisions

## WHAT IS OPEN
  1. **Ascension 10** — no reachable menu screen sets it. The primary metric is unmeasurable
     without it, and at 88% on A0 no improvement is even detectable in principle.
  2. **Unmodelled mechanics** — see `spire-demo/docs/unmodelled-mechanics.md`. Stun is shipped.
     Ravenous 335, Steam Eruption 207, Ritual 156, Plating 148 are next; the per-power win rate is
     the prioritisation method, and most of those ratios are n<6 noise, so MORE RUNS is the lever.
  3. **The resource layer going in** — ANSWERED at iteration 132, see below.

## RULES LEARNED THE HARD WAY — these are not negotiable
- Measure on the wire or in the log, never a proxy or a single sample. **A zero from a lookup is
  evidence about the lookup** — wrong index, 7 times: descriptor, move probabilities, deck piles,
  GAME_DATA keys, can_play, enemy powers vs cards, review heading formats.
- The corpus spans ~100 code versions. Every number names its sha and a recency slice.
- A quiet failure is not a result. Find out why before writing a story about it.
- An existing test refusing a plausible change is the system working. Put the reasoning IN the test.
- Never `npm test | grep` — that returns grep's status. A pipeline in a verification step is a
  verification step that cannot fail.
- Record what was NOT done and why. That is most of the value.
- Measure the effect BEFORE writing the fix. Every one of the four refuted mechanisms looked obvious.
- Check whether a field is a DURABLE property before counting on it. `can_play` is per-frame; `type`
  is not. That is the eighth wrong field and the same family as the other seven.

## ITEM 3 ANSWERED: THE FLOOR-4/5 DEATHS ARE NOT A DIFFERENT SHAPE
  DIED BY FLOOR 6  (n=5)    HP 8   energy 1   hand 4   no playable card 80%   enemy left   5 of 53
  DIED LATER        (n=27)   HP 7   energy 0   hand 2   no playable card 63%   enemy left  47 of 173

**Same resource position in both populations.** The only difference is the enemy's HP: the early
deaths happened against enemies at 5 HP out of 53 — the agent got them to 9% and died doing it.

The shape is arithmetic: **median 0-1 energy with a 2-4 card hand.** At 0 energy only a 0-cost
non-Status card is playable, and at 1 energy only one 1-cost card, so "nothing playable" is the
common case rather than a decision failure.

**And the 81% I had just reported was wrong — the eighth wrong field.** `can_play: false` appears on
889 Strike, 519 Bash and 396 Defend readings. It is a THIS-FRAME flag, not a durable "unplayable" one;
`type` (Status/Curse) is the durable signal. Re-measured with type only: 80% early, **63%** later.

So the item-3 question — do the early deaths share a distinct shape — is answered: **they do not**,
and what looked like an early-game failure mode is the same resource position the rest of the corpus
has.

## M4: ASTRA'S "INVENTING THE REST OF A CARD'S OUTCOME" — CHECKED, AND IT DOES NOT FIRE
astra's claim is sharp and grounded: line 245 admits any recognised game-data effect, and line 342's
`number(text,/Gain (\d+) Strength/i)` credits a start-of-turn buff on the turn it is played, because
`grep "start of your turn" planner.mjs` returns nothing.

**But the card is never simulated in the first place.** On a real Demon Form board the planner
offers only:

    End turn · Mind Blast -> Nibbit · Bully -> Nibbit x2

No Demon Form candidate, so `apply()` never runs and the timing error cannot fire on it. The
admission check rejects it before the bug is reachable. That narrows the finding considerably: the
mechanism is real in the code and unreachable in play for this card.

Measuring the gap that IS reachable — a genuinely usable card in hand with no candidate offering it:

    distinct combat boards examined                                          1848
    boards where a usable card is never offered                            29  (1.6%)
      Spoils Map 23 · Defend 4 · Battle Trance 2 · Forgotten Ritual 2 · Shrug It Off 1

**79% of that is `Spoils Map`** — "Marks a site of +20 Gold in the next Act", a card with no combat
action, so declining to offer it is CORRECT. The genuine defect is `Defend` and `Shrug It Off`
occasionally unoffered: **5 boards in 1848, 0.27%.** Small, real, and not what the review described.

**This is the second review whose headline is wrong in a way measurement settles** (the first was the
partial-survivor one, where the log rather than the gate was at fault). Both were found by running
the claim instead of reading it.

## DOES THE AGENT PICK CARDS IT CANNOT PLAY? NO — AND THE FIRST ANSWER WAS NINE PHANTOMS
  distinct cards the agent picked from rewards        61
  combat boards replayed                             1884
  picked cards never offered as a candidate           2   (Royal Gamble 1x, Juggling 1x)

Both are a single pick each, so this is noise rather than a finding, and the substantive answer is
that **59 of 61 picks are playable.** No deck-efficiency defect: the agent is not filling its deck with
dead weight.

**The first run of this said 33 of 61 were never offered, led by `Shrug It Off` at 13.** That was my
own regex taking the first capitalised token of a label, so `"Shrug It Off"` became `"Shrug"` and every
multi-word card read as phantom. **Ninth wrong index this session, and the third in two days that
produced a dramatic, confident, entirely false number about cards.** The fix is the same as every time:
read the name from the hand at the candidate's own `card_index` instead of parsing it out of prose.

## LOOP STATE
Play running on the batch's real budget (90M tokens, 20k decisions). `labelAmbiguity` and
`deckComposition` are recorded per decision. Batch failures print in capitals and write
`.private/loop/BATCH-FAILED.txt`; a stall is reported after 3 resumes rather than absorbed forever.

The full narrative of every investigation is in `git log` — this file is the state, not the archive.