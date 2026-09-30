---
active: true
iteration: 78
maxIterations: 100
---

keep playing get better every run be bol

## THE TIMEOUT WAS THE BRIDGE, NOT OPENROUTER. FIVE ITERATIONS OF LOOKING AT THE WRONG SERVICE.
Measured the two side by side, 25 and 12 reads each:

  bridge /singleplayer   p50  119ms   p90  256ms   max  269ms
  openrouter /models     p50  136ms   p90  370ms   max  652ms

Both healthy. But an earlier 40-read sample of the same bridge showed:

  p50  130ms   p90 7466ms   p99 15192ms   max 15192ms     2 of 40 hit the abort

So the bridge is **BURSTY, not slow** — clean for 25 reads, then stalling for 15 seconds. It runs
inside the game process, so a hitch on the game side blocks the HTTP response and the client sees a
timeout that has nothing to do with the network.

**And that is why nothing could be told apart for five iterations:** the bridge and OpenRouter both
use `AbortSignal.timeout`, so both failures produce the identical string "The operation was aborted
due to timeout". Every "run N failed: timeout" in the batch log was, at least mostly, the BRIDGE. I
had been measuring OpenRouter's latency distribution and OpenRouter's payload size the whole time.

## Two fixes, and play resumed within the iteration
**1. Retry a bridge read instead of treating it as fatal.** One aborted read was ending a run. The
bursts end; the read is late, not lost. Up to 3 retries with fresh short windows.

**2. Adopt a run already in progress.** The batch opened with `menu_select main_menu`, which is a
silent no-op mid-run, so every subsequent navigation failed and the run died on a timeout that looked
like the network. It now checks first and resumes autoplay on whatever is actually running.

  [a run is already in progress at act 1 floor 12 ascension 0 - adopting it]
  f12 rewards -> card_reward -> f13 monster
  agent: running, 12 decisions

**Both bugs were the same shape as every other one this session**: a client assuming a service was
reliable, and a single blip from it being conclusive. The game is the least reliable participant in
this system and the loop was written as if it were the most reliable.

## What the "diagnostics" of the last four iterations were actually chasing
  67  OpenRouter payload size  -> wrong service, and the size was never the issue
  74  an ascension control that does not exist -> was never verified, walked back at 75
  75  a truncated 180-character read -> was my own slice
  76  a chain that turned out to be real, but whose first link was "model timeouts" and not
      "a flaky bridge stalls every poll"
  77  instrumented the model failure path, which was correct and would never have fired

The instrumentation from 77 was worth building and still has not paid off, because the failures it
would have explained were not the ones happening.

## Loop state
565 tests green - PLAY RESUMED - bridge retry + adopt-in-progress-run shipped
