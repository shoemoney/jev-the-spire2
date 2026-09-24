# Jev The Spire 2

### ▶ Watch it play

[![An agent plays Slay the Spire 2 — 15x faster and 259x cheaper than Claude](media/thumbnail-vs-play.png)](https://youtube.com/@shoemoney)

*Click to watch on YouTube.*

---

**An agent plays Slay the Spire 2 and decides every move in about 315 milliseconds for
$0.00046, which is 15x faster and 259x cheaper than Claude scoring the same decisions.**

Everything below is measured, the harness is in this repo, and the raw results are in
[`SWEEP-FINDINGS.md`](SWEEP-FINDINGS.md). Run it yourself and disagree with me.

---

## Credit where it belongs

This is a fork of **[alexmeckes/jev-the-spire](https://github.com/alexmeckes/jev-the-spire)**
(MIT). The Slay the Spire 2 integration, the planner, the decision fixtures and the grading
suite are all his work, and this repo keeps his full commit history rather than a squashed
snapshot. What this fork adds is a different decision layer on top, plus the measurement to
show whether it was worth doing.

The game bridge is **[STS2MCP](https://github.com/Gennadiyev/STS2MCP)** by Yikun Ji.

---

## What the thing actually is

**[TypeSafe Jev](https://docs.typesafe.ai)** is a decision model, not a chat model. You hand it
a state and a set of typed questions, and it returns calibrated probabilities. It never
generates text, so there is no prompt begging for JSON and no fence-stripping regex on the way
back. Anthropic's Kahneman framing fits: it is a System One model, fast intuitive judgment, and
it is explicitly not built for extended reasoning.

That constraint is the whole design problem. "Which card should I play?" is a System Two
question. So this fork decomposes it into System One questions and recombines them in code:

```
ONE request  ->  move       : choice over every legal action or short plan
                 safe_<id>  : does this survive the displayed incoming attack?
                 prog_<id>  : does this make real progress toward winning?
                 waste_<id> : does this pay a cost whose payoff cannot be collected?

code         ->  normalise each signal, apply weights we own, argmax
```

Every question in that request is evaluated **in parallel and in isolation**, which is the part
that makes it work.

---

## The measurements

### Questions are free. Round trips are not.

Same board, same candidates, four samples each:

| questions | input tokens | cost | median latency |
|---|---|---|---|
| 31 | 18,236 | $0.000766 | 487ms |
| 85 | 23,096 | $0.000970 | 457ms |
| **160** | 29,846 | $0.001254 | **491ms** |

160 questions answer as fast as 31. Tokens scale, latency does not. So a decision needing N
judgments costs **one request, not N** — and the upstream policy's 2.4 sequential calls per
decision were the entire latency problem.

### This fork vs upstream, same graded fixtures

| policy | quality | p50 | calls per decision |
|---|---|---|---|
| upstream `deliberate` | 24/30 (80%) | 758ms | 2.40 |
| **this fork** | **90/100 (90%)** | **325ms** | **1.00** |

### vs frontier models, byte-identical state, 30 decisions each

| model | score | p50 | p90 | $/decision |
|---|---|---|---|---|
| `moonshotai/kimi-k3` | 29/30 | 2,312ms | 69,963ms | $0.01111 |
| `anthropic/claude-opus-5.5` | 29/30 | 3,590ms | 9,025ms | $0.04704 |
| `anthropic/claude-fable-5.1` | 29/30 | 5,534ms | 12,964ms | $0.11952 |
| `x-ai/grok-4.7` | 29/30 | 12,022ms | 31,624ms | $0.01303 |
| **`typesafe/jev-1.13`** | 27/30 | **315ms** | **585ms** | **$0.00046** |
| `openai/gpt-6-astra` | 24/30 | 1,672ms | 3,284ms | $0.03210 |
| `deepseek/deepseek-v4.1-flash` | 24/30 | 23,366ms | 82,839ms | $0.00446 |

**Read this honestly.** The quality gate is a narrow first-action error check on ten fixtures.
The grader says so itself: *"not optimality or win probability."* The noise floor on that corpus
is about ±3, so **27 and 29 are not separable** and Jev is not "smarter" than Claude here. What
is separable, and by a lot, is 6x-63x on speed and 24x-260x on cost.

Also worth saying: Opus 5.5 is the best LLM on this board and it is not close. Same score as
Fable at 35% lower latency, 60% lower cost, and a far tighter tail.

---

## Three things that cost real time to learn

**A factor that did not separate the candidates still voted at full strength.** Min-max
normalising each signal fixed the scale mismatch between a choice probability and a noul, but
when every candidate scored within 0.01 of the others it stretched that gap to a full 0-to-1
swing. Three factors shouting about nothing. A `DEADBAND` of 0.15 raw spread, below which a
factor returns neutral, was worth **+16 points** on its own.

**Capping the fan-out to save money silently disabled the factoring.** At a cap of 28
candidates, 6% of decisions exceeded it and 7% of all candidates got no factor questions at all
— always on the busiest boards. It cost a run: at 7 HP against three enemies telegraphing 17
damage, the top three candidates came back `safe=None prog=None waste=None` with confidence 0,
and the agent died two decisions later. The cap is now 64.

**The endpoint's latency is bimodal and it comes and goes.** Measured on identical payloads:
a fast cluster at 0.34-0.79s and a slow cluster at 7-16s, with nothing in between. Waiting
longer never helps; issuing a second identical request does, because it draws again. Hence
[`hedge.mjs`](spire-demo/hedge.mjs). Four hours later the slow mode was gone entirely and the
hedge never fired across 480 decisions. **Never tune a timeout from one sitting.**

---

## Setup

You need **Slay the Spire 2**, **Node.js 22+**, and an **[OpenRouter](https://openrouter.ai/keys)
key**.

```bash
git clone https://github.com/shoemoney/jev-the-spire2.git
cd jev-the-spire2
cp .env.example .env          # then put your OpenRouter key in it
```

The app also reads `.private/typesafe.cfg`:

```
api_key = "sk-or-v1-..."
```

### The game mod

Install [STS2MCP](https://github.com/Gennadiyev/STS2MCP). **On Slay the Spire 2 v0.111+ the
prebuilt DLL does not load** — it dies with
`ReflectionTypeLoadException: Could not load type ...Multiplayer.LobbyPlayer`. Build from the
`fix/v0.111-compat` branch ([upstream PR #132](https://github.com/Gennadiyev/STS2MCP/pull/132))
against your installed game:

```bash
dotnet build -c Release -p:STS2GameDir="/path/to/Slay the Spire 2"
```

On macOS the mods folder lives inside the app bundle at
`SlayTheSpire2.app/Contents/MacOS/mods/`, and the game **must be launched through Steam** or
Steamworks init fails with "No appID found".

### Run it

```bash
SPIRE_SINGLE_CALL=1 node spire-demo/server.mjs     # dashboard at http://127.0.0.1:4317
```

Start a normal singleplayer run in the game, then press Autoplay. `SPIRE_HEDGE=0` disables
hedging; omitting `SPIRE_SINGLE_CALL` falls back to the upstream multi-call policy.

---

## What this fork adds

| File | What it does |
|---|---|
| [`spire-demo/factored.mjs`](spire-demo/factored.mjs) | One request carrying the broad choice plus three nouls per candidate, recombined in code with weights you own. Includes the deadband. |
| [`spire-demo/hedge.mjs`](spire-demo/hedge.mjs) | Staggered request hedging for a bimodally-slow endpoint. **Idempotent reads only** — game commands are never hedged. |
| [`spire-demo/benchmark/sweep.mjs`](spire-demo/benchmark/sweep.mjs) | Parameter sweep scoring latency against decision quality on fixed fixtures. |
| [`spire-demo/benchmark/vs-llm.mjs`](spire-demo/benchmark/vs-llm.mjs) | Head-to-head against any OpenRouter model on byte-identical state. |

## Reproduce

```bash
node --test spire-demo/*.test.mjs spire-demo/experiment/*.test.mjs   # 214 tests
node spire-demo/benchmark/sweep.mjs --repeats=10 --only=default,waste-veto
node spire-demo/benchmark/run.mjs --scored-only --repeats=3          # upstream control
node spire-demo/benchmark/vs-llm.mjs --repeats=3 --models=anthropic/claude-opus-5.5,x-ai/grok-4.7
```

**A warning that cost me a false headline.** Benchmarking a reasoning model with too small a
`max_tokens` returns **empty content, not an error** — the budget goes to reasoning tokens and
none is left for the answer. My first run scored Fable 2/10 and I nearly published "the
frontier model fails to emit valid JSON 80% of the time." With an adequate budget it scored
46/50 with zero parse failures. Check
`usage.completion_tokens_details.reasoning_tokens` before believing any parse-failure rate.

---

## License

MIT, same as upstream. See [LICENSE](LICENSE).

Slay the Spire 2 is a trademark of Mega Crit. This project is unaffiliated with Mega Crit,
Anthropic, or TypeSafe. Model names appear only to identify what was benchmarked.
