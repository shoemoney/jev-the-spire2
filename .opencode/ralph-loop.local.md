---
active: true
iteration: 48
maxIterations: 100
---

keep playing get better every run be bol

## THIRD SIGNAL BUILT CORRECTLY AND CONNECTED TO NOTHING
Sweep 4's opening finding: "the attrition warning is never delivered." Twelve iterations.

server.mjs computed the verdict and passed it in the options object. `recallingDeliberate`
did not destructure the parameter and called `factoredQuestion(state, candidates)` with no
third argument. The value died at the boundary.

Every unit test passed throughout, because every unit test called
`perspectiveQuestion` directly. **The tested seam was not the broken one.**

And there are TWO builders: `deliberation.perspectiveQuestion` and
`factored.factoredQuestion`. I attached the signal to the first; the shipped recall policy
uses the second. So it reached the unflagged policy and nothing else.

    now, through the real shipped path:
      losing on time -> reaches the request? true
      no verdict     -> reaches the request? false

**Fixed at the base.** `decisionQuestion` takes the verdict and attaches it; `factoredQuestion`
forwards it. A new policy cannot forget it because there is nowhere else for it to be.

## The pattern across all three
1. the seen-card floor, labelled a floor, was a floor on nothing
2. the lower bound, published correctly, went into the request and nowhere else
3. the attrition verdict, computed correctly, was dropped at a function boundary

All three are the same mistake: a value that exists, is correct, is described in a comment, and
is never observed leaving the building. None was caught by a unit test, because a unit test
calls the function directly. All three were caught by something that READS THE SYSTEM —
a reviewer quoting the code, or a loop log.

**A signal is not a signal until a test proves it survives the real path.** That is what
`signal-delivery.test.mjs` now does, hop by hop, including the absent case.

## Loop state
525 tests green · sweep 4 running with 74-file coverage · both batches going · server restarted
