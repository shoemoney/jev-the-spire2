---
active: true
iteration: 69
maxIterations: 100
---

keep playing get better every run be bol

## NINE PROSE CHECKS WERE BEING SENT ON EVERY DECISION REGARDLESS OF THE BOARD
Went one level deeper into the wire (`requestStateBytes`) rather than guessing, and the logged
state is 4.24 KB while 45 KB is sent — the payload WRAPS it. The composition:

  mechanics_review  2.43 KB  20%   <- nine prose checks, unconditionally
  state             2.00 KB  16%
  recalled_experience 1.43 KB 12%
  mechanics         1.43 KB  12%   <- capped at 2048 bytes, deliberately
  facts/candidates/potion_timing ...

`mechanics` is capped at 2 KB and its sibling `mechanics_review`, sitting beside it in the same
object, is not. Eight of the nine checks open with a precondition — "If an intent explicitly
says the enemy will be destroyed after attacking", "If visible minion rules say they abandon
combat without their leader" — and a trash mob has neither.

Now filtered on their OWN stated preconditions, matched on what each check says rather than on
array index, so reordering cannot attach a check to the wrong trigger:

  8 checks -> 3 on a trash mob, 4 with two enemies, 5 on a board with a revival rule

**The rule that matters: a check whose precondition cannot be determined is KEPT.** Absence of
evidence is not evidence of absence, and silently dropping a SAFETY instruction because the
parser could not see its trigger is the worst available failure mode. Unknown text is never
dropped; that has its own test.

  wire: mechanics_review 2.43 KB (20%) -> 1.18 KB (10%)

## How much this is actually worth, stated plainly
About 1.2 KB on a 12 KB payload — roughly 10%. Real, measured, and NOT transformative. The 82 KB
decisions that made me chase this in the first place have a different profile (a much larger
`state`), and I have not re-measured those under the new code. I am not going to call this a
major win because it halved a field; it halved the field that was 10% of a small payload.

## The instrument earned its keep twice more
Both times I was wrong, the answer came from a number rather than an argument: the wire showed
candidates were 0% of the request, and the next level down showed which field actually was. The
cost was two integer fields per decision. That is the cheapest thing I have added to this project
and it has already falsified more of my claims than any amount of reasoning.

## Loop state
562 tests green (7 new) · batch running · state/recalled_experience now the largest parts
