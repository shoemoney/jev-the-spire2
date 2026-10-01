# Unmodelled decision-relevant mechanics

Found by asking the question that surfaced the Stun bug: **which game mechanics does the simulator
never represent?** Not "which code is wrong" — the reviews were reading for that, and they all
graded the code. These are rules the agent has never learned.

Inventory taken from the run log itself (the last two log files, every executed decision), cross-
referenced against `knownEnemyPowers` in `planner.mjs`:
`['strength','weak','vulnerable','slippery','plow','artifact']` — six names, and everything below
is absent.

## Shipped

### Stun — `knownEnemyPowers` has no `stun`
> *(intent type `Stun`, 54 occurrences in the log)*

A living enemy telegraphing Stun means the player loses the **next** turn, so the attack lands twice
with no new block between. The planner has no representation of losing a turn; the only `Stun` in
`planner.mjs` is `bossStunned`, which is the **boss** being stunned by Plow.

```
boss fights where the boss telegraphed Stun : 6 fights   1w 5l   17%
boss fights with no Stun telegraph          : 15 fights  9w 6l   60%
win rate ratio                              : 0.28x
```

**Fix:** withdraw the survival claim (`survives → null`, `uncertain`), do **not** invent a figure for
the unmodelled next attack. 1.8% of distinct combat states. Shipped test-first at iteration 128.

### Thorns — returns `{damage: null}` and blinds every attack that follows
> *"When hit by an attack, deal 2 damage back."* — 105 log occurrences, **all 105** carrying a
> readable `amount`

`retaliationRule` priced retaliation from one exact sentence; the game's sentence differs, so the
name match returned `null`, and `applyRetaliation` treats `null` as ambiguous — which marks the whole
board `retaliation_unknown`. **Half the boards where the agent held no block card were boards where
every card in hand was a Curse, a Status, or `can_play:false`.** Shipped at iteration 99.

## Not modelled, and each one changes the attack-vs-block decision

These are ordered by how often the log shows them. **None has per-mechanic outcome data yet**, so
none is prioritised the way Stun was — that is what the next runs should buy.

| power | log | what the state says | why it changes a decision |
|---|---|---|---|
| **Ravenous** | 335 | *"When an enemy dies, Corpse Slug immediately eats it, becoming Stunned and gaining 4 Strength."* | board-level: which enemy you kill is a real choice |
| **Steam Eruption** | 207 | *"When killed, deals 15 damage at the end of your next turn."* | **kill-or-die**, same class as Stun — killing it still costs 15 |
| **Ritual** | 156 | *"At the end of its turn, gains 2 Strength."* | ramps between turns; the block-vs-race arithmetic ignores it |
| **Plating** | 148 | *"At the end of your turn, gain 9 Block. Plating is reduced by 1 at the start of your turn."* | block grows every turn, so "will I survive" is wrong from turn 2 |
| **Reattach** | 106 | *(needs reading — no text in the sampled log)* | unknown |
| **Slow** | 51 | *"Whenever you play a card, this enemy receives 10% more damage from Attacks this turn."* | **stacking multiplier on Attacks** — the damage forecast under-reads |
| **Minion** | 50 | *"Minions abandon combat without their leader."* | leader-kill is a shortcut the forecast does not represent |
| **Escape Artist** | 49 | *"Tries to escape the combat after 5 turns."* | a soft timer the agent cannot see |
| **Suck** | 44 | *"Whenever Fossil Stalker deals unblocked attack damage, it gains 3 Strength."* | **directly punishes attacking** — unblocked damage feeds its Strength, same class as Stun |
| **Intangible** | 12 | *"Reduce all damage taken and HP loss to 1. Lasts for 1 turn."* | changes what an attack does for a whole turn |
| **Infested** | 23 | *"Upon dying, summons… something."* | kill consequence |
| **Thievery** | 23 | *"Steals 20 Gold when Attacking."* | mild, but it is a cost of attacking |
| **Shriek / Surprise / Demise / Hatch / Hardened Shell / Hard to Kill / Flutter / Personal Hive / Sandpit / Illusion / Slumber** | 7–59 | flavour, triggers, stat tweaks | not decision-relevant on current evidence |

## Intent types the log shows, for completeness

`Attack 3097 · Buff 1068 · Debuff 470 · StatusCard 296 · Defend 180 · Summon 64 · Stun 54 · Heal 39 ·
DebuffStrong 37 · CardDebuff 33 · Sleep 22 · DeathBlow 22 · Escape 9`

**`DeathBlow` (22) is the one not yet classified** and is the same family as Stun — a kill-or-die
telegraph. It is listed here rather than triaged because the log sample did not carry its text.

## How this list was built, and the trap in it

Cross-referencing against the knowledge base finds **nothing**, because `gamedata/game-data.mjs` indexes
**cards, not enemy powers**. That is the seventh time this project reached for the wrong index and
mistook the result for a fact: descriptor, move probabilities, deck piles, `GAME_DATA` keys,
`can_play`, and now this. The descriptions are in the **state**, on each power's own object.

> A zero from a lookup is evidence about the lookup.

The counts are from the last two log files only, so they are the *recent* rate, not the whole corpus.

## Per-power win rate: run, and it corrects two of my own claims

231 closed combat fights, baseline 88%:

| power | n | with | without | ratio |
|---|---|---|---|---|
| Intangible | 2 | 0% | 89% | 0.00x |
| Shriek | 1 | 0% | 88% | 0.00x |
| Vigor | 1 | 0% | 88% | 0.00x |
| Thievery | 3 | 33% | 89% | 0.38x |
| Surprise | 3 | 33% | 89% | 0.38x |
| Steam Eruption | 5 | 40% | 89% | 0.45x |
| Reattach | 2 | 50% | 88% | 0.57x |
| Infested | 3 | 67% | 88% | 0.76x |
| **Stun** | **29** | **76%** | **90%** | **0.85x** |
| Suck | 6 | 83% | 88% | 0.95x |
| Plating | 9 | 89% | 88% | 1.01x |
| Ravenous | 15 | 100% | 87% | 1.15x |

**Stun is 0.85x, not the 0.28x the Stun section quotes.** That figure is BOSS fights only (6 of
them). The mechanic was genuinely unmodelled and the fix stands, but the effect size was read off
the smallest available sample. **Suck is 0.95x — neutral** — and was named a top candidate on the
strength of its description and its log count, which is not a prioritisation.

Everything except Stun is n=1 to 6, where 0.00x means "two fights were lost". **The method survives;
the ordering does not.** More runs, not a longer list.

## CORRECTION (2026-10-01) — this list's priority order is wrong, and it was computed on a broken view
The per-power rates above were measured on an A0-only corpus. That was not a choice: `splitRuns` broke
only on `run_end`, so an `error` event mid-run fused the following run onto it and every per-run figure
was read off the wrong run's last screen. 37 Ascension-10 fights were in the corpus and reported as A3.
With that fixed, the whole corpus gives **35 deaths**, and the cause is now measured end to end:

    fatal board: 2.63 cards, 2.31 of them can_play=false
      EnergyCostTooHigh 59 | HasUnplayableKeyword 17 | BlockedByHook 14
    the agent KNOWS: 0 of 39 fatal boards claimed survives=true
    it does not quit early: end-turn 0.489 losing vs 0.522 winning
    and in 12 of 12 cases where it COULD have reserved a block, the forecast had already warned it

**So the deaths are a correctly-priced position the agent cannot pay to escape** — it ends at 0 energy
facing a 16-damage attack (16.4 mean in lost fights vs 11.4 in won). No decision-layer change fixes
that, and the unmodelled-power work below is therefore *not* the highest-value thing in the project.

**Stun specifically: 0 occurrences on the 35 fatal boards.** The fix shipped at iteration 128 and was
correct to ship — 0.85x is a real if modest effect, and the doc's own retraction of the 0.28x figure
was right. But it addresses a mechanic absent from every board the agent died on.

**The two "measure first" candidates below are now LOWER priority, not higher.** Suck (0.95x, already
measured neutral) and Steam Eruption (n=5) should be re-measured only after the deck question — whether
the run can hold more 0-cost defence by the late turns — is addressed, since that is what the deaths
actually turn on.

## What would prioritise the rest

Stun was prioritised because the log said Stun boards are won at **0.28×** the rate of boards without
one. The same measurement per power is what is missing here: for each unmodelled power, the win rate
of the fights it appeared in against the fights it did not. **Suck and Steam Eruption are the two to
measure first** — both are the punish-attacking / kill-or-die class that Stun turned out to be, and
both are frequent enough (44 and 207) to produce a usable sample quickly.
