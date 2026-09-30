---
active: true
iteration: 72
maxIterations: 100
---

keep playing get better every run be bol

## THE ANSWER TO LAST ITERATION'S QUERY: THERE ARE NO DUPLICATES
  2,275 decisions, 39,095 candidates, every one carrying a plan and a descriptor
    distinct by descriptor : 13,248   (66.7% "duplicate")
    distinct by PLAN       : 39,095   (0.0% duplicate)
    one plan carrying different labels : 0 / 2275

**Every candidate is unique.** The 66.7% was an artefact of `details` not containing the plan, and
my previous iteration's "0.0% of candidates share a command but differ elsewhere" was itself
measured on the command rather than the descriptor — so that number was about a field I was not
actually comparing. Two bad measurements in a row from the same script, both because the id lives
in a different place than I assumed (`candidate.details`, not `deliberation.candidate_details`).

## THE REAL DEFECT, WHICH IS BIGGER THAN A TOKEN PROBLEM
  decisions with 10+ candidates : 1807
    ALL candidates share ONE descriptor          : 1807  (100%)
    candidate.forecast VARIES per candidate      : 1756  (97%)

100% of them. And the shared descriptor's own `forecast` is null. Meanwhile the per-candidate
forecast is computed and lives on `candidate.forecast` — so the largest field on the wire, 30% of
all bytes and 41% of the largest request, is ONE object serialized 33 to 64 times, carrying a null
forecast and describing no plan. The per-plan forecasts the model needs are on the candidates and
are not in this field at all.

**That is a wrong-information problem, not a wrong-size one.** A reviewer reading `candidate_details`
would conclude every option has the same outlook, which is false: 97% of decisions have distinct
forecasts per option, in a different field.

## I BUILT THE COLLAPSE TWICE AND REVERTED IT TWICE — NOT BECAUSE TESTS FAILED
First attempt removed candidate IDS, which is what tripped deliberation.test.mjs's "without removing
defense" guard. That guard was right.
Second attempt collapsed the descriptor and kept every id, which is the correct shape, with tests.
It did not measurably fire: candidate_details stayed 30% of the wire and the largest request grew to
161 KB. Comparing raw strings failed because each descriptor embeds its own id; comparing id-stripped
still did not fire, so the descriptors differ somewhere I have not looked.

**Reverted.** An unverifiable optimisation that does not demonstrably fire is not a win, it is a
change that reads as one in the diff. The finding is banked; the fix needs the real descriptor
shape, which means logging one — the same move that resolved the attrition bugs and the historical
warnings, and the fourth time it has been the thing that worked.

## Loop state
562 tests green · two reverted attempts, one well-evidenced finding, wire size not yet improved
