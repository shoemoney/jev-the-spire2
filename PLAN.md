# 🎯 Get Better: closing the loop on Jev the Spire 2

*Written 2026-09-28 from a forensic pass over the 770-decision run log in `.private/spire-runs/`.*

## 🔬 The diagnosis (measured, not guessed)

The agent is not "not getting better" for lack of effort. **It cannot get better — there is no
learning loop in the codebase.** `grep` for anything that reads past run data returns benchmarks and
a progress report. Nothing in the decision path ever reads a previous run.

That matters far less than the second finding:

### ☠️ It dies while completely blind

```
Combat decisions with forecast quality "unknown":  160/519  =  30.8%
  of which: 94  "Some incoming attacks could not be parsed"
```

Every single decision in the fight that killed the run was `quality: unknown`,
`survives: null`, `incoming: null`. At floor 12 it had 12/86 HP and kept playing
`Defend → End turn → Defend → Defend → End turn` because **it literally could not see the
damage coming.** It did not make bad decisions. It made *no* decisions.

**Root cause — the intent parser is broken.** The game reports attacks as `4x3 (12)`. The
regex in `planner.mjs:254` accepts only `12` or `4x3`. So `parsed=false` → `incoming=null`
→ `quality='unknown'` → every candidate scores `-10000` in `preference()` → ranking is
garbage → Jev picks from a menu of 60 options with no information.

**97 of 97** unparsed labels are fixed by one regex. That is the single highest-leverage
change in this repo.

### 🧱 The second wall: hardcoded allowlists

`planner.mjs:14-18` hardcodes ~50 cards, 11 potions, 12 relics and 26 powers. Anything else
is `unsupported`, which sets the same `quality='unknown'` and blinds the planner *again*.
Observed in one run: `Patter`, `Royalties`, `Sovereign Blade`, `Kingly Kick`, `Solar Strike`,
`Crescent Spear`, plus relics `Divine Right`, `Akabeko`, `Lava Rock`, `Happy Flower`,
`Petrified Toad` and powers `Skittish`, `Slow`, `Infested`. Sixteen relics and fifteen powers
per side exist; the code knows about a third.

### 🧠 And the answer to "how does it get better"

Almost nothing, and the reason is on record. `factored.mjs:51` justifies its split like this:

> *"Equal thirds because there is no labelled data yet to justify anything else."*

`move`, `safe` and `progress` are all `0.25`, so **"equal thirds" is arithmetically true** of
those three; `waste: 1` is a separate **negative** axis, subtracted at `factored.mjs:283`, not a
fourth share of the same pot.

> [!NOTE]
> **The arithmetic in that comment is fine. Its justification is stale, and quietly so.**
>
> `spire-demo/learning/` now exists and is exactly the labelled data the comment is waiting for:
> `attribute.mjs` attributes outcomes, `factor-log.mjs` records factors, and
> `learning/fit-weights.mjs` is the fitter. It **refuses** to emit weights from the real corpus —
> the target is **471 survived turns against 5 deaths**, and a 1%-minority target has nothing to
> separate. Every guard returns `fitted:false, weights:null`. There is no fallback and no
> shrinkage toward equal thirds.
>
> So the honest current statement is **stronger** than "no labelled data yet": the labelled data
> exists, and it has already adjudicated that these weights are not yet fittable. They are still
> hand-set — and they now carry a documented reason for staying that way.

Those weights are still hand-guessed in the sense that no fit has replaced them, but the refusal
above is a real result, not an absence of one. **The gap is that nothing joins outcome data back
to the decisions that caused it** — the 17MB run log is written and, until M0, never read.

---

## ✅ What shipped (measured, on the 519 logged combat states)

| change | before | after |
|---|---|---|
| Combat decisions stating a survival verdict | **69.2%** (359/519) | *not yet re-measured* — see below |
| Plans that close the turn | 0 | 3,883 |
| Plans labelled as prefixes | 0 (silently assumed end-of-turn) | 2,332, each named |
| Tests actually run by `npm test` | 224 | **333** |
| Cross-run memory | none | 6 lessons, 5/5 confirmations on the core death |
| Fresh clone boots | ❌ ERR_MODULE_NOT_FOUND | ✅ |

> [!NOTE]
> The test row is the **figure at the time those changes landed** and is deliberately left as a
> historical record; `npm test` now runs **424** (2026-09-29, 424 pass / 0 fail). The other rows
> are measurements against the 519 logged combat states, which do not move as the suite grows.

Safety gate verified against six cases: it fires only when a plan's own forecast *states* it dies
and another *states* it survives, it stays silent on `unknown`, and it does not refuse a lone lethal
candidate because that would be a guess.

> [!IMPORTANT]
> **Metric correction (2026-09-29) — the blindness row measured two different things.**
>
> This table used to carry a `Blind combat decisions` row with a percentage on the left and a zero
> on the right. Neither side survives contact with the artifact, and the two sides were not the
> same measurement:
>
> - **The "before" was miscounted and misnamed.** That figure is the *unparsed-intent* subset,
>   which the report counts as **94 of 519** decisions carrying the `unparsedIncoming` flag.
>   `94/519` is **18.1%** — the old figure implied a count of 95, and the count is 94. (Do not
>   confuse this with the **97** label *occurrences* quoted further down: 97 occurrences sit
>   inside those 94 decisions, so some decisions carry the flag twice. Occurrences are not
>   decisions, and dividing occurrences by 519 is a third, different number.) It was also not
>   "blind decisions": it is one *cause* of blindness, and the report lists four others.
> - **The "after" was a claim about a number this repo does not publish.** `0.0%` needs a
>   post-fix tier to divide by, and there is no such tier. `node spire-demo/replay/report.mjs`
>   prints, on that same log:
>
>   ```text
>   combat decisions            519
>   unknown forecast            160  (30.8%)
>   partial forecast            359
>   calculated forecast         0
>     unparsedIncoming     94
>   note: this run never emitted an uncaveated combat forecast, so there is no "confident" tier to judge.
>   ```
>
>   `calculated forecast` is **0**. The report says so in as many words. A 0.0% that divides by an
>   empty tier is not a measurement.
>
> **Why there is no "after" column at all for this metric.** The blindness figures are read out of
> the *declared* `forecast.quality` and the warning strings the log already recorded — they
> describe what the **pre-fix** planner emitted. Re-running the report against the same 17MB log
> re-reads those same recorded verdicts; it cannot observe what the fixed planner *would* have
> said. Any honest "after" number here requires a **new recorded run**, which does not exist yet.
>
> So the row above is now a **single metric, measured one way**: the share of combat decisions
> carrying a **stated** survival verdict — 359 of 519, **69.2%** — with the 160 (30.8%) that carry
> none, and 0 carrying an uncaveated one. That is the real current figure and it is **not 100%**.
>
> The old `| Incoming damage null | every unparsed case | 0 |` row was removed for the same reason:
> its `0` was equally unmeasurable on a frozen log.

## 🔎 What the measurement then revealed

Re-planning all 519 states with the fixed planner, the top-ranked plan *states it dies* in 30 of
them — up from 12. That is the system working, not regressing: a stated-lethal verdict only becomes
possible once a plan covers the whole turn, and 20 of the 30 sit on complete turns the old prefix
search never evaluated.

The gate then rescued 1 of those 30, because in **29 of 30 every known plan dies.** Those are not
mispicked winnable boards — they are unwinnable rooms.

> ⚠️ **CORRECTION (2026-09-29).** An earlier version of this document said those 29 states were
> *"100% entered below 30% max HP"*, and concluded the fix was "refuse the fight, heal, route on
> HP and ascension." **That was wrong, and it was wrong because it measured the wrong moment.**
> It read HP at the *late-fight* state — after the damage had already landed — not at the
> *choice*. An adversarial review caught it and built the table from the map trace: of the ten
> times an Elite was offered across the five runs, HP at the moment of choosing was
> **60–100% nine times**, and below 30% only once (10/75).
>
> So the real pattern is worse than "it walked in broken": **it walks into Elites at healthy HP
> and loses them.** 9 of 5 runs' worth of elite entries were made above 60% HP, and the recorded
> outcomes are 4 deaths and 2 near-deaths with no clean elite win. The fix is therefore not
> "heal before the fight" — it is **the elite decision itself**, and it is made 2–4 nodes earlier
> than the fight, when the options are three identically-labelled Monsters and nothing in the
> request says an elite is two rooms out.
>
> Also corrected: `summarizeRun().hpLost` was `hpStart - endHp`, which is not a loss. Every run
> began at 64 HP and ended at 0, so it printed `64` five times. The real cumulative figures are
> 149 / 126 / 100 / 100 / 144 HP — the agent was losing roughly twice what the report claimed.

## 🏗️ The plan

The design principle: **a decision that cannot be evaluated must never be presented as if it
can.** Every phase below attacks one of the three walls.

| Milestone | Wall it breaks | Done when |
|---|---|---|
| **M0** Ground truth | none | Offline replay harness scores past decisions; win rate is a number, not a vibe |
| **M1** See the board | blindness | `unknown` rate < 2% in combat; no nulls on parsed input |
| **M2** Know the game | allowlists | Cards/relics/powers resolve from a knowledge base, not a hardcoded list |
| **M3** Get better | no learning | Outcomes attributed to decisions; weights fitted from data; memory persists across runs |
| **M4** Play well | shallow search | Full-turn plans, deck/route policy, potion timing |
| **M5** Prove it | trust | Replay A/B shows improvement; regression gate blocks regressions |

### M0 — Ground truth
- Replay harness: re-run any logged state through the *current* planner, grade the choice.
- Metrics: forecast blindness rate, HP-loss calibration, decisions that killed the run.
- Baseline recorded before touching anything, so every later claim is measured against it.

### M1 — See the board *(do this first; biggest win by far)*
- Fix the intent regex to parse `NxM (total)`.
- **Graceful degradation:** when a value is genuinely unknown, return a *pessimistic bound*
  ("incoming ≥ 40") instead of `null`. A wrong-but-bounded estimate plays far better than a
  null, because null makes every option look identical.
- A plan that cannot be scored must be *demoted*, never silently ranked alongside scored ones.

### M2 — Know the game
- Extract card/relic/power semantics from the game itself (`sts2.pck` + `sts2.xml` + the mod's
  own state) into a versioned knowledge base.
- Retrieval returns effect semantics for exactly the entities in the current state — small,
  relevant, and cheap. That is the RAG-shaped part, done deterministically.
- Fall back to "treat as opaque, mark bounded" instead of "unsupported, go blind".

### M3 — Get better *(the actual ask)*
- **Attribute outcomes.** Join each decision to what actually happened: HP delta, enemy HP
  removed, whether the run died within N decisions.
- **Fit the weights** that are currently a guess, from that data. Real numbers, real provenance.
- **Persist memory across runs.** Replay past failures: "this relic killed me on floor 12 at
  Ascension 10" becomes context for the next run, not a comment in a source file.
- Fail loudly when there is not enough data to fit — never ship a number pretending to be learned.

### M4 — Play well
- Full-turn planning instead of short prefixes that assume an immediate end of turn.
- Deck-building policy across a run, not per-screen myopia.
- Potion/relic timing with lookahead.

### M5 — Prove it
- Replay A/B: old policy vs new, same states, same seed.
- Regression gate in CI.
- Live runs against the real game, mod installed.

---

## 🚧 Honest limits

- **No live validation until the game is running.** The bridge is down and the game is not
  launched, so win-rate claims stay unproven until M5. Everything up to M4 is verifiable
  offline against 770 real logged decisions — which is a genuinely useful corpus, but it is
  one run and one character, not a benchmark.
- **The logged run is not a win-rate sample.** It is a single Ascension 10 run that died.
  Fitting weights to it risks overfitting to one player's mistakes. M0 therefore fits on
  *survival-signal* (did this decision precede HP loss) rather than "did we win".
- **Ascension 10 is genuinely hard.** "Consistently win" is a target, not a promise. What is
  promised is that the agent stops being blind, stops ignoring its own history, and gets
  measurably better — with the measurement shown.
