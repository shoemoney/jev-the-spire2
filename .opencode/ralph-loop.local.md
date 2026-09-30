---
active: true
iteration: 23
maxIterations: 100
---

keep playing get better every run be bol

## BOSS FIGHTS — n=2 post-reorder now, and the mechanism holds on both
  boss                     HP     removed  waste  damage  arm
  Lagavulin Matriarch      233 -> 140   40%     61%      97  pre-reorder
  Ceremonial Beast         252 -> 127   50%     39%     221  post
  Vantom                   173 ->  72   58%     36%     142  post

Post-reorder, both boss fights removed half or more of the health bar and wasted ~37% of
energy-bearing turns; pre-reorder it was 40% and 61%. Three deaths, no kills — the deck still
runs out of act. But the direction is consistent across two independent post samples and the
mechanism (wasted energy) was predicted before either was measured.

Still n=2 vs n=1. This is NOT a win-rate claim and I will not make one.

## Batch harness fix — auto-paused runs were eating samples
The server auto-pauses on a stall and NOTHING resumed it, so the batch waited out a 45s timeout on
runs that would never move. That cost at least two samples this session. The batch now detects
`mode: paused` with a live game and resumes it, logging that it did.

## Where the sample stands
126 logged fights · 111 won · 15 lost (88%) · 16 runs · best floor 17 (three times)
Runs logged while the server was crashed still count as deaths and carry no data — so read every
figure as "per LOGGED fight", never "per run".
