---
active: true
iteration: 25
maxIterations: 100
---

keep playing get better every run be bol

## THE SERVER DIED SILENTLY
Its log ended on the startup lines with no error and no crash report, and the process was gone. It is
a foreground process started from a tool shell, so it has no supervisor. The batch then sat out its
full 15-minute timeout waiting for a death that could never arrive.

An unattended loop that cannot heal its own agent collects nothing, so the batch now detects a
non-responding server and restarts it, logging that it did. Same resilience shape as the auto-pause
fix: every bug that stops a run silently consumes the data I would need to notice it.

## A SCREEN THAT ATE 22 DECISIONS
"Choose a card to Upgrade" — an `upgrade` screen, 13 cards, `can_confirm: true`. The bridge answers
`select_card` with "Toggling card selection: Strike" and never echoes `is_selected`, exactly like the
Deck Enchant screen. The agent selected, selected, selected: **22 decisions, `confirm_selection`
offered 12 times, never taken.**

Tested by hand against the bridge: `confirm_selection` on that screen advances it to `map`,
immediately, with no selection at all. So confirming was the entire task and the agent spent 22
decisions toggling instead.

Not yet fixed. The honest statement is that on a card_select screen where confirm alone advances,
the agent has no reason to prefer it, and `selectionState` reconstructing a phantom selection across
13 identical "Strike" entries gives it more to think about rather than less. Two candidate fixes,
neither tried: make confirm strictly preferred when the reconstructed selection already satisfies the
prompt, and deduplicate identical card names in the selection reconstruction.

## Sample
Boss fights still n=2 post-reorder. Batch restarted (8 runs) with both resilience fixes in.
