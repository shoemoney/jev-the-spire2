---
active: true
iteration: 19
maxIterations: 100

---

keep playing get better every run be bol

## TWO REAL BUGS, BOTH MINE, BOTH FOUND BY READING THE ERROR NOT THE DASHBOARD

**1. `seenCards` killed the decision loop on every restart.** `view` is persisted to
session.json and restored verbatim; JSON has no Set, so a restored Set comes back as `{}` and
`[...view.seenCards]` threw "(view.seenCards ?? []) is not iterable". That aborted the step and left
the server PAUSED with the exception as its message. It had been happening on every restart since
iteration 10 — including the one that made a run look "stuck" when the server was simply dead.
Seen cards is now an ARRAY, which round-trips through JSON intact.

**2. A card-selection overlay was a dead end.** A run sat on "Choose 3 cards to Enchant" with nine
confirms executed and the screen never advancing. `actionsFor` offered `select_card` only for cards
NOT already selected, so a wrong selection could only ever be confirmed, never undone — while the
vendor api-reference says `select_card` TOGGLES on a grid screen. Every card is now offered,
selected ones labelled `Deselect <name>`. Confirmed live: the agent now gets real options there.

Three tests pinned the old no-toggle rule. Their real guards were kept — confirm still requires the
prompted count, and `selectionState` still never marks a card selected twice — and only the menu
assertions moved.

## Why this mattered more than it looks
Both bugs make a run STOP. A stopped run produces no data, and every conclusion this session is
already sample-starved. The measurement work and the play work are the same work here.

## Measurements unchanged
fights 106 · won 94 · lost 12 (89%) · best floor 17 · 502 tests green
