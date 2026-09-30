---
active: true
iteration: 49
maxIterations: 100
---

keep playing get better every run be bol

## SWEEP 4 FINDING #2 — EIGHTEEN OF TWENTY-NINE POTION TYPES WERE INVISIBLE
`apply()` read `listed || potion ? null : ...`, sending every potion down an eleven-name
hand-written allowlist and nothing else. An unlisted potion marks the play `unsupported`,
which blanks the forecast and blinds the lethal gate for the WHOLE TURN.

  Entropic Brew      372 sightings
  Attack Potion      335
  Colorless Potion   251
  Skill Potion       166
  Fairy in a Bottle  73      <- heals to 30% instead of dying

The game data could not see them either: it only matched `{Placeholder}` substitutions, and
Fairy writes "you heal to 30%" in prose. A prose layer now recognises heal/draw/upgrade/
add-to-hand/random-potion/repeat — with `Draw` requiring `Draw N` or `Draw cards`,
because "Draw Pile" is a zone and the first attempt matched it and promoted Cascade past
`unsupported` on a false reading.

**Structure licenses promotion only when the play is otherwise modelled.** Game data says
what a card DOES, never what it COSTS; an X-cost play has an energy cost the planner cannot
simulate, so promoting it on effects alone promised unspent energy it had no basis for.

## The honest outcome, and the test asserts it
Block, Swift and Speed simulate. Fairy in a Bottle stays `unsupported` and states NO survival
claim — the planner has no clause for a trigger at zero HP, and promoting it would produce a
confident wrong number. Unknown is the correct answer there. The test says "not everything
works" on purpose.

## Pattern, now five instances
1. seen-card floor: labelled a floor, was a floor on nothing
2. lower bound: published, went into the request and nowhere else
3. attrition: computed, dropped at a function boundary
4. potion allowlist: eleven names standing in for twenty-nine
5. classifier: matched placeholders only, so every prose effect was invisible

Four of the five are the same shape: a list or a rule that LOOKS comprehensive and quietly
is not. None was caught by a unit test. All were caught by something reading the whole system.

## Loop state
528 tests green · server restarted with potion visibility · game batch and sweep 4 both running
