---
active: true
iteration: 67
maxIterations: 100
---

keep playing get better every run be bol

## PLAY DIED, AND THE CAUSE IS THE PROMPT SIZE
The batch failed with "The operation was aborted due to timeout". Not the API — it is healthy and
fast: p50 270ms, p90 480ms, p95 649ms over 4154 decisions. A 30s timeout is ~100x the median, and
the only historical 30s decisions were the ones with 30k input tokens. So this was never a network
problem; it is payload size.

Today's ordinary monster decisions, in input tokens:
  6,977   7,062   8,821   15,246   15,871   20,783   21,189   23,557   23,883   26,471
and the timeouts begin immediately after the 26,471-token decision. 291 decisions in all history
exceeded 20k tokens.

What is actually IN the payload, measured on a 23,557-token monster decision:
  candidates      71.7 KB   81%
  memory           8.3 KB    9%
  state            4.0 KB    5%
  deliberation     2.8 KB    3%
  factors          1.4 KB    2%

**81% is the candidate action list, to choose between Strike and Defend.** 71.7 KB of candidates
for one turn in a trash mob is the whole problem, and it is also the bill.

## What I have NOT established, stated plainly
That is the size of the LOGGED candidates, not the size of the request SENT. The planner may
already trim them into a compact prompt, in which case the 26k tokens come from somewhere I have
not measured and this analysis is pointing at the wrong thing. The next step is to log the actual
request body size next to the logged payload and compare, because guessing which one it is would
be the same mistake as the last two: reasoning about the code instead of measuring the wire.

## Also worth knowing
`/tmp/srv.log` is NOT the agent server — something else on this machine owns that path and its
output is a different HTTP service. I spent a diagnostic cycle reading it. The agent is `node
server.mjs` (pid 34330) and `/api/status` answers 200.

## Loop state
555 tests green · batch restarted · this is a measurement, not yet a fix
