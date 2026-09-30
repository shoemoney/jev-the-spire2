---
active: true
iteration: 22
maxIterations: 100
---

keep playing get better every run be bol

## DATA-QUALITY NOTE, found while counting boss fights
14 runs in the store, 14 distinct runIds, 14 `run_end` events — no duplicates, so the store is
sound. But only **2** boss fights exist, while three runs record a death at floor 17. The third has
NO preceding decision in its log: that run played while the server was crashed by the `seenCards`
crash, so it produced a death record and no data.

**A run that happens while the agent is down still counts as a death and contributes nothing to any
measurement.** Until the batch produces clean runs, `runs` overstates what was actually observed.
Every statistic in this project should be read as "per LOGGED fight", never "per run".

## The reorder on the boss — still n=1 per arm, and now correctly counted as FIGHTS not files
  Lagavulin Matriarch  233 -> 140  (40% removed) | waste 61% | damage  97 | run ended
  Ceremonial Beast     252 -> 127  (50% removed) | waste 39% | damage 221 | run ended
Two fights, both deaths. Damage more than doubled on the same number of decisions.

## Batch restarted (6 runs) purely for sample size
Every open question here is sample-starved: n=1 per arm on the boss, n=26 on the 3+ blocking
bucket. Nothing is being decided this iteration except taking more samples.
