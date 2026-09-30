---
active: true
iteration: 87
maxIterations: 100
---

keep playing get better every run be bol

## THE BUDGET CAP I FOUND LAST ITERATION WAS MY OWN MISCONFIGURATION
I said more boss fights were needed and that the token budget capped them at one run per session,
because 12,413 input tokens per decision against a 10,000,000 budget buys about 805 decisions.

Then I read the line that sets it. The batch's own restart path already uses:

  MAX_INPUT_TOKENS: '90000000'   MAX_DECISIONS: '20000'

**90 million, not 10 million.** At the measured burn rate that is roughly 7,200 decisions, or about
twelve runs per server session. There is no cap. The cap was the server I started by hand with
default env an hour ago, and I measured my own misconfiguration and reported it as a property of
the loop.

That is the sixth time in this session that a number described the setup rather than the system, and
it is the same shape every time: I read a live value, did not ask which configuration produced it,
and treated the result as a fact about the code. It is also the first one where the error was
*optimistic* — it told me something was blocking me when nothing was — so the discipline that caught
it was not scepticism, it was simply going back to read the line.

Server restarted on the batch's intended budget: 0/20000 decisions, 0/90000000 tokens, sha 3f5eebd.
Play resumed.

## Where the loop actually stands
  play: running, one full run banked at act 1 floor 17 this batch
  the open question (do the scorer's overrides help or hurt) needs more boss fights
  the budget is not the constraint, and was never the constraint

So the correct action for this iteration was the one I named — play, not analysis — and it turned
out to also be a one-line configuration correction. The distinction matters: had I "fixed" the
budget in the code I would have been editing a limit that was already set correctly, on the authority
of a measurement of my own shell.

## Loop state
565 tests green - server on the batch's real budget (90M tokens, 20k decisions) - play running
- the token budget is NOT a constraint on boss-fight accumulation
