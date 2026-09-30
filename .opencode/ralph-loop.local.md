---
active: true
iteration: 53
maxIterations: 100
---

keep playing get better every run be bol

## THE STORE'S BEST NUMBER WAS REACHING NOBODY
The store holds `elite 29/52 won (56%)` — the agent's own measured elite record over twenty runs. It
was attached by `recallingDeliberate`, so it reached exactly ONE policy of five, and the default
policy decided whether to walk into an elite with that number sitting unread.

The base question builder has two return paths. The non-combat one is where MAP decisions live —
precisely the elite decision — and it returns early. **My first attempt attached to the combat
branch only, which would have reproduced the attrition bug on a different screen.**

That is the THIRD time in this loop a signal has reached one of two paths, and it is now the first
thing I check when wiring anything new. `recall-delivery.test.mjs` asserts both branches carry the
record, that the attrition note reaches both, and that supplying nothing attaches nothing.

## The good news inside the store
  monster 547/576 won (95%), 13.8 HP average cost
  elite    29/52  won (56%)
Elite was 11/34 (32%) when this record was first computed. It has roughly doubled as the run-level
guidance, the complete turns, and the potion visibility landed. Still the worst class by a wide
margin, and now at least the agent can see the number when it decides.

## Loop state
535 tests green · sweep 4: 9/14 · game batch restarted · server up
