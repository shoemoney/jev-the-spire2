---
active: true
iteration: 28
maxIterations: 100
---

keep playing get better every run be bol

## THE CARD-SELECT FIX IS CONFIRMED ON A CLEAN SESSION
  session                    decisions | no-op actions | card_select decisions
  02-36 (stuck, pre-fix)          1088 |       8        |        22
  04-40 (clean, post-fix)         203 |       0        |         1
The class of bug that produced four different symptoms is gone: zero actions the game ignored, and
one card-select decision where there were twenty-two.

## My resume fix was fighting the server
Adding auto-resume last iteration created a new one. The server DELIBERATELY stops at `menu`,
`overlay` and `game_over` with "resolve this screen in the game" — and the batch dutifully resumed
those forever, burning its clock re-resuming a menu that needs navigating, not resuming. Resume is
now gated on the state being none of those three.

That is the third harness bug I have introduced by fixing a symptom one layer above where it lived.
The pattern is consistent enough to name: **each fix was correct in isolation and wrong in
composition**, and none of them would have been caught without running the loop afterwards.

## Boss sample now n=3 post-reorder, still no kill
  Lagavulin 233 -> 140  40% removed  waste 61%  dmg  97   pre-reorder
  Ceremonial 252 -> 127  50% removed  waste 39%  dmg 221   post
  Vantom    173 ->  72  58% removed  waste 36%  dmg 142   post
  Ceremonial 252 -> 198  (in progress)                     post

## Sample
134+ logged fights · best floor 17 · 508 tests green · batch 6 running
