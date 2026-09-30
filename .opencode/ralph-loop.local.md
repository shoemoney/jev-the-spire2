---
active: true
iteration: 101
maxIterations: 100
---

keep playing get better every run be bol

## THE GAME IS UNBLOCKED AND PLAY RESUMED
The click landed — the bridge went from `menu/main` with zero options to `state_type: event`, a run
already in progress. The batch had died in the meantime, so it was restarted; it adopted the live run
and the agent is deciding again. That single click is what unblocked the last eight iterations of
measurement work.

## FOURTH REVIEW'S SECOND FINDING: HALF CONFIRMED, AND THE CAUSAL CLAIM IS NOT ESTABLISHED
claude-opus-5-5 finding 2 says the agent dies holding usable potions because unlisted potions go
`unknown`, rank at -10000, and become invisible to the gate. Measured:

    combat deaths                                       30
    holding a usable potion at the fatal board          8   (27%)
    a potion-play action WAS among the candidates       8
    NO potion-play action was offered at all            0
    ...of those boards, at least one potion action was 'unknown'   8

**Half of it is solid: 8 of 30 combat deaths happened with a usable potion in hand, and in every one
of those the agent had a potion-play action available.** That is a real number about real deaths.

**The causal story is NOT established, and my own measurement is weaker than the review's:**
  - `supportedPotions` has 11 names and **`speed potion` is one of them** — so the flagship example is
    a LISTED potion, not an unlisted one
  - my check was `some(...)` not `all(...)`, so it only shows at least one potion action was unknown
  - 6 of the 8 held potions ARE in the game-data KB, and line 221 records that potions were
    *deliberately* excluded from the KB fallback
  - and drinking a potion is not unconditionally right: holding Entropic Brew while an Elite kills you
    can be correct if the potion does not help

So: **deaths with an unused potion are real, and "the agent hoards potions it cannot model" is a
hypothesis the data does not yet support.** The decisive test is whether a *surviving* potion-play
candidate was available on those 8 boards and declined — and that is one query, not shipped until run.

## The running pattern across four reviews
Real code observation every time. Effect measured before acting every time. Three fixes, one
decline on a number, and one finding half-confirmed with the causal claim explicitly withheld. **The
reviews are not the bottleneck. Deciding what to do with them is, and that is the part worth keeping.**

## Loop state
PLAY RESUMED - 590 tests green - one click unblocked eight iterations of measurement
- A/B accumulating toward 200 armed samples
