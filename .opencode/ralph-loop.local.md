---
active: true
iteration: 64
maxIterations: 100
---

keep playing get better every run be bol

## THE GUARD: A LOG ENTRY THAT CANNOT NAME ITS CODE CAN BE MISREAD FOREVER
Iteration 63's whole cost was that 94 warnings from a parser fixed days earlier read as a live
bug, and nothing in the record said which version wrote it. Two halves, both shipped:

  1. server.mjs resolves {code:{sha,dirty}} once at boot and stamps EVERY log entry. Live check:
     server code stamp: {'sha': 'b01af33', 'dirty': 0}
     `dirty` is recorded rather than smoothed over. A run on a commit with uncommitted edits is
     not reproducible from that commit, so it is labelled unreproducible instead of being quietly
     attributed to HEAD — which would be the same class of lie as the warnings, one level up.
  2. Fights carry `day` and `code`; summariseFights groups `byCode` and names the days each
     version played. Unstamped records are their OWN bucket, never folded into the newest sha —
     folding them is precisely the conflation that caused the error.

## The design question worth answering: what does a code change MID-FIGHT do?
My first test asserted it splits the fight. It does not, and that is right: the fight did not end.
A fight is attributed to the code it STARTED on, because a fight half-played by two versions is
not a fight half-played by either, and splitting would manufacture a short fake fight and a short
fake remainder out of one real one. The test now pins that instead of the behaviour I assumed.

## The new default question
The instrument can now answer "how did the CURRENT code do", which is the only version of that
question worth asking. Historical fight records carry code:null, so the split is honest about what
it does and does not know:

  byCode  unsta... 155 fights   <- everything recorded before this change
           b01af33   0 fights   <- nothing yet, as expected

Zero on the new stamp is correct and expected. It becomes the only trustworthy bucket within one
batch of play, and every number from here on can name its own provenance.

## Loop state
550 tests green (3 new) · sweep 4: 11/14 · server up, stamping
