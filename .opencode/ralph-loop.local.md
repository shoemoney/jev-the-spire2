---
active: true
iteration: 70
maxIterations: 100
---

keep playing get better every run be bol

## candidate_details SCALES WITH CANDIDATE COUNT, AND THE COMPACTOR IS NOT THE PROBLEM
Across 52 measured decisions on current code:
  p50 21.6 KB · p90 57.3 KB · max 69.3 KB   (the 82 KB decisions are gone from this batch)

  median candidate_details by number of legal candidates:
     <=10 candidates:  0.8 KB  (n=40)
     11-20 candidates: 15.0 KB  (n=10)
     21-40 candidates: 21.2 KB  (n=12)

Roughly 0.8 KB per candidate above the 10 mark, and a cliff between 10 and 11. So a board that
offers 28 legal actions spends 26.3 KB of a 72.9 KB request on describing them.

**It is not a formatting problem.** compactRequest() already strips `forecast.assumption`, groups
identical cards, trims the observation arrays, and interns repeated forecast objects losslessly.
25 KB is genuinely distinct forecast data. There is nothing left to compress — the size IS the
number of things the model is being asked to choose between.

## And I was half-wrong again, in the same way
Last iteration I said "candidates are not the story" from a 12 KB sample where candidate_details
was 0.73 KB. It is 26.3 KB in a 73 KB one. The mistake was sampling one decision and generalising;
the answer was bimodal all along and I read the mode, not the distribution. Percentiles would have
told me that immediately, and there are now 52 measured decisions to take them over.

## The fix is a POLICY change, and I am not shipping it on this evidence
Capping which candidates get a full forecast is not a formatting tweak — it can remove the action
that would have won. That is the same shape as the graded-survival treatment I declined to build
for changing 5 boards in 2191, and the bar is the same: measure first.

The measurement is available and cheap, because the log already records which candidate was chosen.
The question that decides it: **for the decisions with 11+ candidates, how deep in the list was the
one actually chosen?** If the answer is "always near the front", a cap is nearly free. If the agent
regularly wins with candidate 24 of 28, then those 26 KB are load-bearing and cutting them buys
1 KB of tokens at the price of the run.

Not measured yet. Next.

## Loop state
562 tests green · batch running · percentiles now the default, not a single sample
