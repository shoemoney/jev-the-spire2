---
active: true
iteration: 35
maxIterations: 100
---

keep playing get better every run be bol

## I ALMOST SHIPPED A WRONG FRAMING, AND CAUGHT IT IN THE SAME BREATH
I read "61 decisions" and wrote "a war of attrition — 40 to 67 decisions to fight a boss." **That
was decisions, not turns.** Measured properly:

  monster   median  4 turns, max 11   (n=108)
  elite     median  6 turns, max 20   (n=14)
  boss      median 11 turns, max 14   (n=5)

**Boss fights last 11-14 turns.** That is a normal Slay the Spire boss fight, not a grind. The
"war of attrition" line was mine, it was wrong, and I had already typed it before checking. That is
the SEVENTH time this loop a confident claim of mine came from reading the wrong unit.

## WHAT THE NUMBERS ACTUALLY SAY
  lost fights entered at 53 HP average
  ~5.4 HP lost per TURN across an 11-14 turn boss (1.2 per decision x ~4.5 decisions per turn)
  53 HP / 5.4 per turn = about 10 turns of life, and the fight runs 11-14

So the boss does its damage every turn and the deck cannot out-sustain it. It is a deck problem —
as I have said for several iterations — but now measured in the right unit instead of asserted in
the wrong one.

## THE DANGER SIGNAL, DESIGNED (and the lesson from the wrong unit)
The signal I deferred last iteration should be per TURN, not per decision, and it should be
arithmetic rather than a heuristic:

  turnsToLive  = hp / damageTakenPerTurn
  turnsToKill  = enemyHp / damageDealtPerTurn
  losing on attrition when turnsToLive < turnsToKill

Nothing here is invented: both rates are observed from the fight the agent is already in, and the
verdict is a comparison of two counts. The same discipline as `incomingMax`, as the idle-turn notice
and as the card conditions — a derived fact, not a judgement.

It needs per-turn accumulation in the server (HP deltas and damage deltas, keyed on the fight the
way `seenCards` is keyed on `runKey`), and it must report `unknown` rather than a verdict on the
first turn, when there is no rate yet.
