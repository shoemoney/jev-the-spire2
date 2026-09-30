---
active: true
iteration: 71
maxIterations: 100
---

keep playing get better every run be bol

## THE CAP IS DEAD, AND THE REASON IS MEASURED, NOT GUESSED
For 1741 executed decisions with 11+ candidates, the depth of the CHOSEN candidate (1 = first):
  min 1 · p50 6 · p90 18 · max 63
  beyond position 10: 484/1741 (28%)

**A cap at 10 breaks 28% of these decisions.** The 26 KB of candidate_details is load-bearing. Not
shipping the cap, on the same standard that stopped the graded-survival treatment.

## WHY THE AGENT PICKS DEEP: THE LIST IS 63% DUPLICATES
  39,504 candidates across 2,336 decisions
  exact command duplicates : 24,716  (63%)
  full-descriptor duplicates: 24,716  (62.6%)   <- 0.0% share a command but differ elsewhere

One 64-candidate board held 19 distinct commands and **13 distinct labels** — "Strike -> Wriggler ->
Setup Strike" appeared about sixty times, and the chosen action was "Defend" at position 63. The
model was not finding a hidden gem; it was reading past sixty copies of one plan to reach an option
that should have been at the top.

**That reframes the whole thing.** The 26 KB is sixty copies of one forecast, and the deep picks are
a symptom of burying distinct options among identical ones. Dedup is safe where a cap is not —
identical descriptors carry identical information — and the numbers say the duplicates really are
identical (0.0% differ outside the command).

## BUILT IT, AND AN EXISTING GUARD SAYS NO — SO IT IS REVERTED
Implemented full-descriptor dedup in compact-request.mjs with four tests. Two of my own tests
caught a real over-collapse first (keying on `String(parsedObject)`, which is `[object Object]`, and
keying on the command alone, which merges candidates that carry no command at all — that one was
caught by a PRE-EXISTING test, which is exactly what it was written for).

Then `deliberation.test.mjs` failed: "kill-versus-block review ... without removing defense"
expected both candidates and dedup removed one. The fixture builds `kill` and `block` with identical
descriptors, differing only by id and label.

**That is evidence dedup can remove a distinguishable option, and I cannot tell from here whether
the real corpus has that shape.** In the corpus labels DO differ (13 distinct labels), so the real
duplicates may be safe — but "may be" is the standard I have refused to ship against five times now.
Reverted. 562 green.

The remaining question is specific and cheap: **do any two candidates in the real corpus share a
descriptor AND differ in label?** If none do, dedup is provably lossless and the change is a
straight 63% cut in the largest field on the wire. That is one query and it decides it.

## Loop state
562 tests green · dedup reverted pending one query
