---
active: true
iteration: 86
maxIterations: 100
---

keep playing get better every run be bol

## THE CONFOUND CANNOT BE REMOVED WITH THE DATA I HAVE
I said a within-fight comparison at matched turn index would settle the 2.17-vs-4.08 question. Two
attempts, and the second is the honest one.

**Attempt 1 was impossible by construction.** I tried to pair a changed and an unchanged decision
at the same fight AND the same turn index. There is exactly one decision at each turn index, so it
can never be both. Zero pairs. That was a design error, not a finding.

**Attempt 2, matched on depth across fights: also zero.** Bucketing every decision by its index
within its own fight and requiring >=3 of each kind per bucket produced no usable bucket at all.

The reason, and it is a real property of the data rather than a bug:

  turn index: how often the scorer overrode, across all boss fights
     0   73%     4   83%     8   58%
     1   71%     5   83%     9   67%
     2   57%     6   25%    10   50%
     3   46%     7   75%    11   50%

`changed` **is** correlated with how deep into the fight the decision is — it ranges from 25% to 83%
by turn index. So the confound I named is real, not a hedge. But each index holds only 2 to 15
decisions across the whole corpus, and that is not enough to match on depth with any usable n.

**So: 2.17 versus 4.08 damage per decision stays uninterpreted.** It is not evidence that the
overrides are harmful and it is not evidence that they are harmless. With 15 boss fights in the
entire corpus and a per-index n of 2-15, the question is underpowered, and no amount of clever
analysis of this data will fix that.

## What this actually costs, and what it buys
Two of the three candidate explanations for the Ceremonial Beast losses are now refuted by
measurement (ordering, scorer bias toward defence), and the third is real, located in
`wire.mjs`, and cannot be evaluated on the evidence available. **That is a legitimate place to stop
and it is not a place to ship anything.** Every change in this session that survived contact with
data did so because a measurement came first; the temptation right now is to make one that does not,
and the whole record of the last twenty iterations is a list of what that produces.

The resolution is not more analysis. It is **more boss fights** — which is the thing the loop is
already doing, and the only genuinely scarce input in this system.

## Loop state
565 tests green - override question UNDERPOWERED (15 fights, 2-15 decisions per turn index) - `changed`
is genuinely correlated with depth (25-83% by index), so the confound is real - no change shipped, and
the correct next action is play, not analysis
