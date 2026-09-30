---
active: true
iteration: 56
maxIterations: 100
---

keep playing get better every run be bol

## THE NINETEEN COLORLESS CARDS HAVE ART AND NO TEXT
I went looking rather than typing them in, which was the point. Results:

  "bandage up"   0 occurrences in the entire 2GB pack
  "BANDAGE_UP"   0
  "Bandage Up"   0
  "CORPSE_EXPLOSION" 0

And in the extracted localization text, of ten names I checked, **eight appear nowhere**. The two that
do — "bite", "calm" — are substrings inside other cards' descriptions, not entries of their own. Every
card that IS in the knowledge base has its name present in the text: vintage, bash, impervious,
inflame, pommel strike, entropic brew, fairy in a bottle — all true.

**So this is not a matching bug and not a scan-window miss.** Those atlas files are ART for cards
whose text this build does not ship — reserved content, or text living somewhere I have not located.

**The 94% figure is therefore closer to 100% of the cards that actually have text**, and the nineteen
are not a gap I can close honestly. Typing them from their names would be inventing their effects,
which is the Colossus mistake, the `distinctCardsSeenThisRun` mistake and the `lower_bound` mistake
in one move. They stay unknown, and the planner re-observes.

This also retires the task I set last iteration. The next concrete task is NOT "find the nineteen" —
it is something that can actually be answered.

## Loop state
535 tests green · sweep 4: 9/14 · game batch running · server up
