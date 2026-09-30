---
active: true
iteration: 79
maxIterations: 100
---

keep playing get better every run be bol

## A0 FIGHT WIN RATE IS SATURATED, SO STOP MEASURING IT
Every stamped version since the code stamp went in reports A0 between 83% and 100%:

  ff06fa6  6 fights  83%      abbd694  5 fights  100%      35ddb56  3 fights  67%

16 fights, all Ascension 0, all inside the noise. **The metric I have been steering by is
saturated** — a policy that wins 88% of trash-mob fights has no headroom there, and no amount of
additional A0 data will show whether anything improved.

The A0 signals that are NOT saturated, and are therefore the ones worth watching until ascension
becomes available:
  - **boss win rate at A0: 5/11 (45%)** — genuinely mid-range
  - **depth reached** — median floor 17, best 31, and still climbing in the corpus

So the honest framing of everything since iteration 62: the difficulty gradient was real and worth
finding, and at A0 the interesting question stopped being "can it win a trash mob" and became "can
it finish a boss". Neither can be compared across code versions yet, because only 2 stamped runs
have ENDED. The instrument is correct; the data needs time.

## TWO MORE BATCH DEFECTS, BOTH OF WHICH SUPPRESSED EVIDENCE
**1. It printed a mean for runs that never happened.** `results` was read back from the previous
batch's `batch.json` and appended to, so every invocation ended by printing that batch's floors plus
every run ever taken. A batch in which nothing occurred still printed:

  floors: 17, 5, 17
  n=3 mean=13.0 best=17

I quoted that line twice across two iterations as though it were fresh. Output that reports a mean
for work that did not happen is worse than no output, because it reads as a result. Each invocation
now owns its results and writes an invocation stamp.

**2. One failed run cancelled the batch.** The catch block did `break`, so a single flaky bridge read
— precisely the thing iteration 78 spent itself fixing — ended every remaining run. That is the
difference between a loop that accumulates evidence and one that restarts from zero whenever the
game hitches, which is most of the time. It now continues.

Both are the same failure as iteration 78's two: the loop treating one unreliable event as
conclusive, in the harness this time rather than the client.

## Loop state
565 tests green - batch resilient and its output honest - play advancing f13 -> f14, 68 decisions
- A0 fight rate saturated, boss rate 5/11 and depth are the live signals
