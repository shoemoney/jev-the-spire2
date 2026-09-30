---
active: true
iteration: 43
maxIterations: 100
---

keep playing get better every run be bol

## SWEEP 3 FINDING #3 — HALF ALREADY TRUE, HALF A DOC LIE
The review said the default policy is `deliberate` and carries no gate. Half of that was already
handled by my own iteration-25 work: `deliberate.mjs:161` applies `refuseLethalChoice` to the final
answer, and the server derives `gate: active|absent` from each policy's OWN SOURCE and prints it at
boot. The safety half is genuinely fine.

The other half was a real documentation lie: the README opened by describing a ~315ms one-call
agent, while a bare launch runs the multi-call `deliberate` at ~2.4 calls and ~758ms. The headline
described a configuration and read as the default. Now the note sits directly under it, the launch
command shows the shipped flags, and the test badge is corrected 386 -> 516.

## THE PATTERN IN THE REVIEW LOOP IS WORTH NAMING
Every finding so far is the same shape as the eight measurement errors I made myself:
  a number or a rule that is technically true, and practically misleading
- elite guidance gated to the act where 95% of deaths do NOT happen
- a "floor on the deck" that was a floor on nothing
- a 315ms headline for a configuration nobody launches by default
- a 89.4% calibration that mixes counterfactuals with executed turns

Outsiders keep finding the class I have been unable to see from inside it. That is the argument for
running the loop rather than only running the tests.
