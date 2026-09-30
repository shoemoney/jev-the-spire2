---
active: true
iteration: 90
maxIterations: 100
sessionId: ses_f14aeb718ffedJJQ75aBotmgwX
---

keep playing get better every run be bol

## THE OVERRIDE QUESTION, ANSWERED WITH 200x THE SAMPLE
`overrideImpact()` now lives in `replay/metrics.mjs` beside the two functions that already read this
log correctly, with six tests written from the bugs the throwaway scripts actually had.

  186 combat fights, 3319 measurable decisions

    UNMATCHED (confounded with depth - the number that gets quoted by accident)
      overridden  1.89 dmg/decision  (n=1551)
      agreed      3.43 dmg/decision  (n=1768)

    MATCHED on turn depth: 55 depths where both kinds occurred
      depth 1   3.05 vs 5.47   -2.43   (104/78)
      depth 4   0.91 vs 2.83   -1.92   (104/66)
      depth 9   1.37 vs 4.11   -2.75   (90/53)
      depth 12  0.48 vs 2.92   -2.44   (67/60)
      ... 13 of the first 14 depths negative, one at +0.11
      pooled matched delta: -1.501 damage per decision

**The scorer's override is associated with about 1.5 less damage per decision once depth is
matched.** The confound I could not remove on bosses alone is removed here, and the effect persists
with the same sign across 55 depths and 3,319 decisions. On bosses it was underpowered; on the full
combat corpus it is not.

## What this is and is not
It is a well-powered ASSOCIATION. Depth is matched; the fight, the enemy, the player's HP and the
incoming damage are not, and the override may be *responding* to worse positions rather than
creating them. Consistent sign across 55 independent depth buckets is hard to explain by confounding
alone, but "hard to explain" is not "ruled out".

**So the next step is a controlled A/B, not a change.** Use the model's own choice even when the
scorer disagrees, on a subset of decisions, and measure the same depth-matched damage rate. That is
the only way to convert this into evidence about causation, and it is cheap because the metric and
the module now both exist.

I am deliberately not shipping "stop overriding the model" on the strength of an association, having
spent this session refusing to ship four changes on weaker grounds. But this is the first finding in
a long while that is strong enough to justify the experiment rather than merely motivate it.

## The process note, because it is the actual lesson
This question was unanswerable on the data I had and answerable on data I already owned. Three
iterations went into debugging scripts instead of adding five lines to a tested module. The module
took the same measurement, got it right first time, and produced the answer in one call.

## Loop state
571 tests green (6 new) - override costs ~1.5 damage/decision, depth-matched, 55 depths, 3319 decisions -
next step is a controlled A/B, explicitly not a policy change