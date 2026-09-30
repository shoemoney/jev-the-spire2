---
active: true
iteration: 44
maxIterations: 100
---

keep playing get better every run be bol

## MORE BOSS DATA — SIX FIGHTS, SIX DEATHS, BUT TWO GOT BELOW 20%
  Lagavulin Matriarch  233 -> 140   40%   waste 61%  dmg  97
  Ceremonial Beast     252 -> 127   50%   waste 39%  dmg 221
  Vantom               173 ->  72   58%   waste 36%  dmg 142
  Ceremonial Beast     252 ->  73   71%   waste 21%  dmg 593
  Waterfall Giant      240 -> 1e9   ---   waste 26%  dmg 393   (sentinel pool)
  Vantom               172 ->  27   84%   waste 18%  dmg 215
  Waterfall Giant      240 ->  45   81%   waste 38%  dmg 248

Two of these left the boss under 20% of its health. Still no kill. The waste rate on the
close ones is 18% and 21% — the menu work is holding — and the fight still runs out of act.

## A DISPLAY BUG IN MY OWN SCRIPT
The percentage printed `-416666560% removed` for the billion-HP sentinel, because the arithmetic
ran against a value that is not a health pool. A percentage computed on a placeholder is exactly
the confident-not-supported number this project exists to reject — and this one was in MY tool,
not the agent. The throwaway script is fixed; the committed tool does not compute that percentage,
which is the right way to avoid it.

## ELITE RECORD HAS MOVED
  before this iteration:  11/34  (32%)
  now:                    17/40  (43%)
Six more fights, six more wins. That is 6-for-6, which is not credible as a rate on its own and I am
not claiming the act-gate fix caused it. It is the best the elite number has looked in the project.
