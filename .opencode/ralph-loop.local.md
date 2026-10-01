---
active: true
iteration: 103
maxIterations: 100000
---

Autonomous operation. Play, measure, and improve the agent. Keep the loop and the batch running.

## THE PLAN
M1 INSTRUMENT  measurement precedes every change (done)
M2 EVIDENCE    a live comparable difficulty signal  <- the binding constraint
M3 DECISION    answer the override question and act on it
M4 READ        finish the frontier reviews and convert them
M5 HARDEN      no unmeasured change ships; failures are diagnosable

## M5 DONE - a loop that cannot fail loudly is not a loop
One batch invocation played a full run to act 2 floor 25, printed its summary, and exited having been
asked for six runs. No `break`, no `process.exit`, no visible cause. Now: unhandled rejections and
uncaught exceptions print in capitals to stderr AND write `.private/loop/BATCH-FAILED.txt`, and a
keep-alive interval holds the event loop open. If it ever stops again it will say why.

## M4 IN PROGRESS - the elite lead, tested and REFUTED
Last iteration found the real pattern in elites: 12 of 20 elite fights entered at <=20 HP, against a
monster win rate near 92%. That suggested a route lever - do not commit to an elite while depleted.

**Tested it. It is not real.**

  ELITE + BOSS fights by the HP the agent ENTERED with
    <=20 HP     n= 4   won 2  lost 2    50%
    21-40 HP    n= 2   won 2  lost 0   100%
    41-60 HP    n= 5   won 1  lost 4    20%
    >60 HP      n=28   won 16 lost 12   57%

**No monotonic relationship, and the low-HP bucket is BETTER than the mid one.** Entering a fight at
20 HP or less wins half the time; entering at 41-60 wins a fifth. So "entering low causes the loss"
is the opposite of what the data says, and the route change I was about to build would have been
built on an inversion.

The buckets are also small (n=2-5), so the honest position is: **underpowered, and what it does show
contradicts the claim.** The 12/20 low-HP figure was a correlation I read as a mechanism, which is
the same mistake as the 47%-blindness claim - a count that looks like a cause.

What IS still standing, and is per-encounter rather than per-HP:
  Byrdonis 0/2 · Phantasmal Gardener 0/1 · Terror Eel 0/1 · Skulking Colony 3/1 · Bygone Effigy 4/1
Byrdonis at 0/2 is the one worth watching, and n=2 is not a finding.

## M2 EVIDENCE - the binding constraint
Ascension 10 cannot be set from the bridge: no reachable menu screen exposes a difficulty control,
confirmed in full (IRONCLAD, SILENT, REGENT, NECROBINDER, DEFECT, RANDOM_CHARACTER, confirm, embark,
back). The primary metric is therefore unmeasurable from here and everything else is downstream of
that. A run is the only input that moves anything, so the batch stays alive.

## M3 DECISION - A/B accumulating, read with abImpact
Randomised scorer-vs-model override, interleaved within a run, arm effect verified on real play.
`abImpact` pools by sample and refuses to report below 8 depths AND 200 samples. At 25/200.

## Standing rules
- Measure on the wire or in the log, never a proxy or a single sample
- The corpus spans many code versions; every number names its sha
- A quiet failure is not a result
- An existing test refusing a plausible change is the system working
- Record what was NOT done and why

## Loop state
590 tests green - batch running with loud failure - elite entry-state lead REFUTED - reviews 4 of 10
