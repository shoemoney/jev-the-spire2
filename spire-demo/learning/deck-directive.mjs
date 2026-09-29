// The deck-absence branch, in a module neither of its callers owns.
//
// The card-reward focus in decision-focus.mjs is written ENTIRELY in terms of the
// permanent deck: "Compare every offered card and Skip against the actual permanent
// deck." The bridge does not send one - `player.deck` is present in 0 of 775 logged
// records - so `deckAssessment` reports `available:false` and the assessment on the
// same request STATES the gap.
//
// Appending the focus anyway hands the model two instructions that contradict: judge
// against the actual permanent deck, and also here is the deck assessment reporting
// the deck is missing. It has to reconcile a contradiction rather than read a fact,
// so on that board the requirement was both unsatisfiable and loud. Suppressing the
// focus and substituting `deckUnavailableInstruction` keeps the same take-or-skip
// judgement grounded in what the board DOES supply.
//
// This started in factored.mjs and was copied into better-policy.mjs, which is the
// same second-copy drift this project has already paid for twice: the first copy was
// correct on the day it was written, and the second path kept the bug until someone
// read both files. Two branches, one rule. Both callers import this instead.
//
// No cycle: this depends only on decision-focus.mjs and deck-assessment.mjs, neither
// of which reaches into learning/, and neither of which imports a caller.

import { decisionFocus } from '../decision-focus.mjs';
import { deckAssessment, deckUnavailableInstruction } from '../deck-assessment.mjs';

/**
 * The `move` instruction this board's focus actually supports, or `undefined` when
 * the focus has none.
 *
 * Returns the screen's own focus text UNCHANGED whenever the deck it names is
 * present - this is a fix for the one board where the focus is unsatisfiable, not a
 * blanket downgrader, and a real deck assessment must still get its real criteria.
 */
export function deckAwareMoveInstruction(state) {
  const focusMove = decisionFocus(state).instructions?.move;
  if (!focusMove) return focusMove;
  // `available === false` is the absence; anything else, including a future shape
  // that adds fields, is a board that answered. Only card rewards name a deck.
  if (state?.state_type === 'card_reward' && deckAssessment(state)?.available === false) {
    return deckUnavailableInstruction;
  }
  return focusMove;
}

export default { deckAwareMoveInstruction };
