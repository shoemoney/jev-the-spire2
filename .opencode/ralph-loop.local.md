---
active: true
iteration: 40
maxIterations: 100
---

keep playing get better every run be bol

## THE HANDBACK IS CONFIRMED, NOT ASSUMED
The bridge exposes ascension only in MULTIPLAYER lobby objects (`max_ascension`, `ascension` fields in
`multiplayer_load_lobby` / `multiplayer_join` examples). The singleplayer `character_select` options
are, verbatim from the vendor reference: character IDs/names, `back`, `confirm`/`embark`,
`unready`. There is no ascension control on the singleplayer path.

`custom` mode does not help either: the reference states a `seed` "is only supported in menu contexts
that expose a real seeded flow. Standard singleplayer character select currently returns an error
without starting a run when `seed` is supplied."

No Ascension-10 save is on disk to resume either — the only save-path directory belongs to the
UnifiedSavePaths mod and the run that produced floor 31 was started fresh.

**So comparable Ascension-10 data requires a human to start a run at Ascension 10 in the game UI.**
That is the one thing the loop genuinely cannot do for itself.

## The tool now refuses to pool across difficulty
`fight-outcomes.mjs` prints `!! MIXED ASCENSION {...} — NOT a like-for-like sample` and refuses to
present a pooled win rate without the cut. A metric that can silently change difficulty must not be
summarised without it.

## Per-ascension, the honest baseline
  ascension  0:  9 deaths, best floor 31
  ascension  3:  1 death,  floor 14
  ascension 10: 10 deaths, floors 14,9,11,12,6,8,7,15,17,6   best 17

Ascension 0 median death floor 17, Ascension 10 median 11. The gap is real and it is the reason
last iteration's headline could not be believed.

## The batch warns, loudly, on every non-10 run
  [run started: ascension 0]
  [WARNING: ascension is 0, not 10 — this run is NOT comparable to earlier ones]
Working as intended: it fired on the first run after the fix.
