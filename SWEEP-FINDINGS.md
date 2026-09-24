# Sweep findings, 2026-09-23

Goal: get decision latency down without getting dumber.

680 graded decisions across 11 configs, then the two leaders re-run at n=100 each.
Total API spend: **$0.30**. Raw data in `.private/sweep-results.json`.

## Winner

`WEIGHTS = { move: 0.25, safe: 0.25, progress: 0.25, waste: 1 }`, hedge unchanged at 900ms / 3 attempts.

| policy | quality | p50 | p90 | calls per decision |
|---|---|---|---|---|
| `deliberate` (original, multi-call) | 24/30 (80%) | 758ms | 1171ms | 2.40 |
| equal weights, waste 1/3 | 88/100 (88%) | 290ms | 456ms | 1.00 |
| **winner, waste 1.0** | **90/100 (90%)** | **325ms** | 478ms | **1.00** |

**2.3x faster on p50, one call instead of 2.4, and 10 points better on quality.**

## The two changes that actually mattered

Neither was a latency setting.

### 1. A deadband on factor normalisation, +16 points

The factors are min-max normalised across candidates so a choice distribution and an
independent noul can be compared. With no floor on the spread, a factor where every
candidate scored within 0.01 of the others got stretched to a full 0-to-1 swing and
voted at full strength on nothing but noise.

Observed on the `beckon-play` fixture: safe spanned 0.07-0.13, progress 0.05-0.08,
waste 0.80-0.87. Three factors with no opinion, all voting at full volume.

Adding `DEADBAND = 0.15`, below which a factor returns neutral for every candidate,
moved the equal-weights config from **36/50 to 44/50** with no other change.

### 2. A `waste` factor, +20 points

The first version asked two nouls per candidate (survives the turn, makes progress)
and scored 6/10. Every failure was a self-harm or dead-setup trap: Bloodletting on an
empty hand, Fortifier, Pact's End. Those are a *cost* question, which neither existing
factor asks.

Adding a third noul ("does this pay a lasting cost whose payoff cannot be collected
here?") and weighting it as a veto took the config from **35/100 equivalent to 90/100**.
The original policy catches these with several thousand words of review prose; one
narrow question does it in the same round trip.

## What did NOT matter: every latency setting

| config | p50 | p90 | mean attempts |
|---|---|---|---|
| delay 900 / 3 (default) | 305ms | 519ms | 1.00 |
| delay 500 / 3 | 276ms | 449ms | 1.07 |
| delay 250 / 3 | 268ms | 425ms | 1.77 |
| delay 250 / 5 | 295ms | 418ms | 1.87 |
| delay 400 / 4 | 274ms | 405ms | 1.10 |
| no hedge | 273ms | 440ms | 1.00 |

All within noise of each other. **The endpoint stayed in its fast mode for the entire
sweep and the hedge never fired once.** Shortening the delay does not buy speed, it
buys duplicate requests: delay 250 averaged 1.77 attempts per decision, 77% more spend,
for nothing.

Earlier the same day the same code measured p50 5,824ms against this endpoint, with a
bimodal split (fast 0.34-0.79s, slow 7.07-16.20s, roughly 53% slow). **Latency here is
a property of the service's mood, not of our settings.** The hedge is insurance whose
value is zero while the service is fast and large when it is not, so the delay belongs
just above fast-mode p99 (~650ms) where it costs nothing to carry. 900ms stands.

## The accidental control group

Six configs differed *only* in hedge timing, which cannot affect which action is chosen.
They scored 9, 10, 11, 12, 12, 13 out of 18. That range is the noise floor for this
10-fixture corpus. It is why `waste-veto` at 15/18 and `no-waste` at 8/18 were treated
as real effects while the 1-point gaps between latency configs were not.

## Known remaining failure

`waste-veto` fails `beckon-play` **10 times out of 10**. It is the only fixture it fails.

The cause is upstream of the factoring: Jev's broad `move` question gives `End turn` a
probability of **0.82** on that state while every Beckon line gets 0.01-0.04, and all
three factors are flat there. Raising the progress weight does not fix it (tested at
0.5 and 0.6, still 100% failure). `no-waste` fails it too, so the factoring neither
caused it nor can weights repair it.

The original policy fails the same fixture 3 times in 10, so it is a weakness in both,
just a worse one here. This is a real trade: the winner never plays Beckon, in exchange
for never poisoning itself. Net is +10 points, but the loss is total on that one case.

## Honest limits

- **The quality gate is 10 fixtures.** `grade()` says it plainly: "Narrow first-action
  error check; not optimality or win probability." It can show a config got dumber. It
  cannot show one plays better. Nothing here is a win-rate claim.
- **Overfitting risk is real.** The `waste` question was written after seeing which
  fixtures failed. It is phrased generally, against no card name, and it fixed two
  distinct fixtures rather than one, but 10 cases is a small set to be steering with.
- **All latency numbers were collected in fast mode.** The config that wins under
  congestion was not measured, because the congestion did not return. The sweep should
  be re-run the next time p50 goes above a second.
- Per-config quality differences under 3 out of 50 are inside the noise floor above.

## Reproduce

```bash
node spire-demo/benchmark/sweep.mjs --repeats=10 --only=default,waste-veto
node spire-demo/benchmark/run.mjs --scored-only --repeats=3   # original policy control
```
