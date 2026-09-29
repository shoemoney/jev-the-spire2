# 🎯 Get Better: closing the loop on Jev the Spire 2

*Written 2026-09-28 from a forensic pass over the 769-decision run log in `.private/spire-runs/`.*

## 🔬 The diagnosis (measured, not guessed)

The agent is not "not getting better" for lack of effort. **It cannot get better — there is no
learning loop in the codebase.** `grep` for anything that reads past run data returns benchmarks and
a progress report. Nothing in the decision path ever reads a previous run.

That matters far less than the second finding:

### ☠️ It dies while completely blind

```
Combat decisions with forecast quality "unknown":  159/518  =  30.7%
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

Nothing. `factored.mjs` says it outright:

> *"Equal thirds because there is no labelled data yet to justify anything else."*

Those weights were hand-guessed and never fitted, because no outcome data is ever joined back
to the decisions that caused it. The 17MB run log is written and never read.

---

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
  offline against 769 real logged decisions — which is a genuinely useful corpus, but it is
  one run and one character, not a benchmark.
- **The logged run is not a win-rate sample.** It is a single Ascension 10 run that died.
  Fitting weights to it risks overfitting to one player's mistakes. M0 therefore fits on
  *survival-signal* (did this decision precede HP loss) rather than "did we win".
- **Ascension 10 is genuinely hard.** "Consistently win" is a target, not a promise. What is
  promised is that the agent stops being blind, stops ignoring its own history, and gets
  measurably better — with the measurement shown.
