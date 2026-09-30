---
active: true
iteration: 73
maxIterations: 100
---

keep playing get better every run be bol

## LOGGED THE DESCRIPTOR. IT IS 35 DISTINCT PLANS AND 31 KB OF REAL INFORMATION.
  path: state.candidate_details
  ids: 35   distinct: 35   bytes: 31,225
  each value: {"sequence":[{"label":"Bash -> Ceremonial Beast","command":{"action":"play_card",...

**Every value is distinct and each carries a `sequence` of labelled steps with real commands.** This
is 35 different multi-card plans, described once each.

## SO THE PROMPT IS NOT WASTEFUL AND THE SIZE IS THE DECISION
  p50 wire 28.1 KB   p90 77.6 KB
A 35-way choice among genuine multi-card plans costs what it costs. There is no repetition to
collapse, no shared object to hoist, and no cap that would be safe. The 28%-of-decisions-beyond-
position-10 is not a symptom of distinct options being buried - it is the model reading 35 real
options and picking the one it judges best, which is the behaviour the depth measurement was
supposed to explain and now does.

**Three iterations of chasing prompt waste, and the answer is that there is none.** The size is the
information content. The one real win in the whole line of inquiry was iteration 69 (nine relevance-
free prose checks, 2.43 KB -> 1.18 KB), and even that was 10% of a small payload.

## I WAS WRONG IN ITERATION 72, AND THE WRONG MEASUREMENT IS NAMED
I wrote "100% of decisions with 10+ candidates share ONE descriptor, whose forecast is null." That
was measured on `candidate.details` in the LOG - a different object from the wire's
`state.candidate_details`, which is assembled later. The logged one is a per-candidate summary; the
one on the wire is the per-plan sequence. I compared a summary against a plan, found the summary
repetitive, and reported it as repetition in the thing being sent.

That is the fifth time in six iterations a tidy causal story did not survive contact with the real
object, and in every case the instrument that caught it was logging the actual thing rather than
thinking harder about a proxy. Four reverted attempts and a wrong headline to show for it. The
correct move now is to stop chasing the payload and go back to the win rate.

## Also: the backgrounding pattern was the real time sink
`( ... node server.mjs & )` kept dying between iterations. The server runs fine in the foreground
and fine under `nohup ... & disown`. Three diagnostic cycles went to a process-management problem
while I believed I was diagnosing a payload problem - again a story about the wrong layer.

## Loop state
562 tests green - payload investigation CLOSED as a genuine dead end - win rate untouched since 62
